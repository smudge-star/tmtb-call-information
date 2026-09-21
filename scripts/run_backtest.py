#!/usr/bin/env python3
"""Run the 21/63-session TMTB reset-horizon portfolio backtest."""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import sys
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path


def add_dependency_paths(project_root: Path, state_dir: Path, explicit: str | None) -> None:
    candidates = [explicit, os.environ.get("TMTB_PYTHON_DEPS"), str(project_root / "tmp" / "pydeps"), str(state_dir / "python")]
    for candidate in candidates:
        if candidate and Path(candidate).exists():
            sys.path.insert(0, str(Path(candidate).resolve()))


def edition_from_file(file_name: str) -> str:
    lowered = file_name.lower()
    if "morning-wrap" in lowered:
        return "Morning"
    if "eod-wrap" in lowered:
        return "EOD"
    if "weekly" in lowered:
        return "Weekly"
    return "Other"


def source_url(source_dir: Path, file_name: str) -> str | None:
    path = source_dir / file_name
    if not path.exists():
        return None
    match = re.search(r"(?m)^source:\s*(\S+)\s*$", path.read_text(encoding="utf-8"))
    return match.group(1) if match else None


def max_drawdown(series) -> float:
    import pandas as pd

    with_base = pd.concat([pd.Series([1.0]), series.reset_index(drop=True)], ignore_index=True)
    return float((with_base / with_base.cummax() - 1.0).min())


def next_weekday(timestamp):
    """Return a conservative next-session placeholder when future prices are unavailable.

    Yahoo is the source of truth for realized entries.  This helper is only used
    to label a pending plan in the daily audit; it deliberately does not invent
    a price or apply the pending call to realized NAV.
    """

    result = timestamp + timedelta(days=1)
    while result.weekday() >= 5:
        result += timedelta(days=1)
    return result


def target_cash_for_names(names) -> tuple[float, float]:
    count = len(set(names))
    if count == 0:
        return 0.0, 1.0
    each = min(0.20, 1.0 / count)
    return each, 1.0 - each * count


def performance(nav, daily_returns, qqq_returns, years: float) -> dict:
    import pandas as pd

    aligned = pd.concat([daily_returns, qqq_returns], axis=1).dropna()
    aligned.columns = ["strategy", "qqq"]
    strategy_std = float(aligned["strategy"].std(ddof=1))
    qvar = float(aligned["qqq"].var(ddof=1))
    beta = float(aligned["strategy"].cov(aligned["qqq"]) / qvar) if qvar > 0 else None
    active = aligned["strategy"] - aligned["qqq"]
    active_std = float(active.std(ddof=1))
    return {
        "total_return": float(nav.iloc[-1] - 1.0),
        "cagr": float(nav.iloc[-1] ** (1.0 / years) - 1.0) if nav.iloc[-1] > 0 else None,
        "annualized_volatility": strategy_std * math.sqrt(252),
        "sharpe_rf_0": float(aligned["strategy"].mean() / strategy_std * math.sqrt(252)) if strategy_std > 0 else None,
        "max_drawdown": max_drawdown(nav),
        "beta_vs_qqq": beta,
        "annualized_alpha_vs_qqq": float((aligned["strategy"].mean() - beta * aligned["qqq"].mean()) * 252) if beta is not None else None,
        "information_ratio_vs_qqq": float(active.mean() / active_std * math.sqrt(252)) if active_std > 0 else None,
    }


def run_strategy(calendar, prices, events_by_date, horizon: int, cost_rate: float):
    import pandas as pd

    active_expiry: dict[str, int] = {}
    weights: dict[str, float] = {}
    cash_weight = 1.0
    gross_nav = 1.0
    net_nav = 1.0
    rows = []
    call_actions = {}
    reset_calls = 0
    rebalance_days = 0
    last_rebalance = None

    for i, current_date in enumerate(calendar):
        prior_net_nav = net_nav
        if i > 0:
            prior_date = calendar[i - 1]
            end_values = {}
            stock_value = 0.0
            for ticker, weight in weights.items():
                prior_price = prices.at[prior_date, ticker]
                current_price = prices.at[current_date, ticker]
                ratio = float(current_price / prior_price) if pd.notna(prior_price) and pd.notna(current_price) and prior_price > 0 else 1.0
                end_values[ticker] = weight * ratio
                stock_value += end_values[ticker]
            growth = cash_weight + stock_value
            gross_nav *= growth
            net_nav *= growth
            if growth > 0:
                weights = {ticker: value / growth for ticker, value in end_values.items()}
                cash_weight /= growth

        expired = sorted(ticker for ticker, expiry_index in active_expiry.items() if expiry_index <= i)
        for ticker in expired:
            del active_expiry[ticker]

        entries = events_by_date.get(current_date, [])
        for call in entries:
            ticker = call["ticker"]
            was_active = ticker in active_expiry
            if was_active:
                reset_calls += 1
            expiry_index = i + horizon
            active_expiry[ticker] = expiry_index
            call_actions[call["call_id"]] = {
                "action": "Reset" if was_active else "New",
                "expiry_date": calendar[expiry_index].strftime("%Y-%m-%d") if expiry_index < len(calendar) else None,
                "remaining_sessions_after_history": max(0, expiry_index - (len(calendar) - 1)),
            }

        cap_breach = max(weights.values(), default=0.0) > 0.2000000001
        rebalance = bool(expired or entries or cap_breach)
        turnover = 0.0
        if rebalance:
            active = sorted(active_expiry)
            target_each = min(0.20, 1.0 / len(active)) if active else 0.0
            target_weights = {ticker: target_each for ticker in active}
            target_cash = 1.0 - target_each * len(active)
            universe = set(weights) | set(target_weights)
            turnover = 0.5 * (
                sum(abs(target_weights.get(ticker, 0.0) - weights.get(ticker, 0.0)) for ticker in universe)
                + abs(target_cash - cash_weight)
            )
            net_nav *= 1.0 - cost_rate * turnover
            weights = target_weights
            cash_weight = target_cash
            rebalance_days += 1
            last_rebalance = current_date

        event_parts = []
        if expired:
            event_parts.append(f"Expired: {', '.join(expired)}")
        if entries:
            event_parts.append(f"Calls: {', '.join(sorted({call['ticker'] for call in entries}))}")
        if cap_breach and not expired and not entries:
            event_parts.append("20% cap rebalance")
        rows.append({
            "date": current_date.strftime("%Y-%m-%d"),
            "gross_nav": gross_nav,
            "net_nav": net_nav,
            "daily_net_return": net_nav / prior_net_nav - 1.0 if i > 0 or rebalance else 0.0,
            "active_count": len(active_expiry),
            "invested_pct": 1.0 - cash_weight,
            "cash_pct": cash_weight,
            "turnover": turnover,
            "max_weight": max(weights.values(), default=0.0),
            "event": "; ".join(event_parts),
            "active_tickers": ", ".join(sorted(active_expiry)),
        })

    frame = pd.DataFrame(rows).set_index(pd.to_datetime([row["date"] for row in rows]))
    final_index = len(calendar) - 1
    current_positions = [
        {
            "ticker": ticker,
            "weight": float(weights.get(ticker, 0.0)),
            "expiry_date": calendar[expiry].strftime("%Y-%m-%d") if expiry < len(calendar) else None,
            "remaining_sessions": max(0, expiry - final_index),
        }
        for ticker, expiry in sorted(active_expiry.items())
    ]
    extras = {
        "average_invested_pct": float(frame["invested_pct"].mean()),
        "average_cash_pct": float(frame["cash_pct"].mean()),
        "total_turnover": float(frame["turnover"].sum()),
        "rebalance_days": rebalance_days,
        "reset_calls": reset_calls,
        "max_observed_weight": float(frame["max_weight"].max()),
        "last_rebalance_date": last_rebalance.strftime("%Y-%m-%d") if last_rebalance is not None else None,
        "current_positions": current_positions,
        "current_cash_pct": cash_weight,
    }
    return frame, extras, call_actions


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project-root", required=True)
    parser.add_argument("--source-dir", required=True)
    parser.add_argument("--state-dir", required=True)
    parser.add_argument("--signals", required=True)
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--python-deps")
    parser.add_argument("--horizons", nargs=2, type=int, default=[21, 63])
    parser.add_argument("--cost-bps", type=float, default=10.0)
    parser.add_argument("--as-of", help="Calendar date for the daily audit; defaults to the local current date")
    args = parser.parse_args()

    project_root = Path(args.project_root).resolve()
    source_dir = Path(args.source_dir).resolve()
    state_dir = Path(args.state_dir).resolve()
    add_dependency_paths(project_root, state_dir, args.python_deps)
    try:
        import pandas as pd
        import yfinance as yf
    except ImportError as error:
        raise SystemExit(
            f"Missing Python dependency: {error.name}. Install yfinance and pandas into {state_dir / 'python'} or pass --python-deps."
        ) from error

    signals = json.loads(Path(args.signals).read_text(encoding="utf-8"))
    manifest = json.loads(Path(args.manifest).read_text(encoding="utf-8"))
    if not signals:
        raise SystemExit("Signal ledger is empty")
    horizons = sorted(set(args.horizons))
    if len(horizons) != 2 or any(horizon <= 0 for horizon in horizons):
        raise SystemExit("Exactly two positive holding horizons are required")
    cost_rate = args.cost_bps / 10000.0
    tickers = sorted({row["ticker"] for row in signals})
    yahoo_symbols = {ticker: ticker.replace(".", "-") for ticker in tickers}
    symbols = sorted(set(yahoo_symbols.values()) | {"QQQ"})
    as_of = pd.Timestamp(args.as_of).normalize() if args.as_of else pd.Timestamp(date.today()).normalize()
    first_call = min(pd.Timestamp(row["file"][:10]) for row in signals)
    start = (first_call - pd.Timedelta(days=10)).strftime("%Y-%m-%d")
    end = (as_of + pd.Timedelta(days=2)).strftime("%Y-%m-%d")

    download = yf.download(
        symbols,
        start=start,
        end=end,
        auto_adjust=False,
        actions=False,
        group_by="ticker",
        threads=True,
        progress=False,
    )
    raw_series = {}
    failed_tickers = []
    for ticker in tickers + ["QQQ"]:
        symbol = yahoo_symbols.get(ticker, ticker)
        try:
            series = download[symbol]["Adj Close"].dropna().astype(float).copy()
        except (KeyError, TypeError):
            failed_tickers.append(ticker)
            continue
        series.index = pd.to_datetime(series.index).tz_localize(None).normalize()
        series = series[~series.index.duplicated(keep="last")].sort_index()
        if series.empty:
            failed_tickers.append(ticker)
        else:
            raw_series[ticker] = series
    if "QQQ" not in raw_series:
        raise SystemExit("QQQ history is unavailable")

    qqq_calendar = raw_series["QQQ"].index
    qqq_calendar = qqq_calendar[qqq_calendar <= as_of]
    if qqq_calendar.empty:
        raise SystemExit(f"QQQ has no available price on or before as-of date {as_of.date()}")
    prices = pd.DataFrame(index=qqq_calendar)
    for ticker, series in raw_series.items():
        prices[ticker] = series.reindex(qqq_calendar).ffill()

    calls = []
    pending_calls = []
    events_by_date = defaultdict(list)
    price_data_end = qqq_calendar[-1]
    for call_id, signal in enumerate(sorted(signals, key=lambda row: (row["file"], row["ticker"], row["quote"])), start=1):
        ticker = signal["ticker"]
        call_date = pd.Timestamp(signal["file"][:10])
        series = raw_series.get(ticker)
        entry_date = None
        entry_price = None
        planned_entry_date = None
        entry_status = "Excluded - Yahoo unavailable"
        if series is not None:
            eligible = series[(series.index > call_date) & (series.index <= as_of)]
            if not eligible.empty:
                entry_date = eligible.index[0]
                entry_price = float(eligible.iloc[0])
                entry_status = "Included"
            elif call_date >= price_data_end:
                planned_entry_date = next_weekday(max(call_date, price_data_end))
                entry_date = planned_entry_date
                entry_status = "Pending - future market data"
            else:
                entry_status = "Excluded - no post-call close"
        call = {
            "call_id": call_id,
            "ticker": ticker,
            "file": signal["file"],
            "call_date": call_date.strftime("%Y-%m-%d"),
            "edition": edition_from_file(signal["file"]),
            "quote": signal["quote"],
            "signal": signal["signal"],
            "qualifier": signal["qualifier"],
            "source": source_url(source_dir, signal["file"]),
            "entry_date": entry_date.strftime("%Y-%m-%d") if entry_date is not None else None,
            "planned_entry_date": planned_entry_date.strftime("%Y-%m-%d") if planned_entry_date is not None else None,
            "entry_adj_close": entry_price,
            "entry_status": entry_status,
        }
        for months, prefix in ((1, "m1"), (3, "m3")):
            call[f"{prefix}_date"] = None
            call[f"{prefix}_adj_close"] = None
            call[f"{prefix}_return"] = None
            if entry_status == "Included" and entry_date is not None and entry_price is not None:
                target_date = entry_date + pd.DateOffset(months=months)
                exit_prices = series[(series.index >= target_date) & (series.index <= as_of)]
                if not exit_prices.empty:
                    exit_date = exit_prices.index[0]
                    exit_price = float(exit_prices.iloc[0])
                    call[f"{prefix}_date"] = exit_date.strftime("%Y-%m-%d")
                    call[f"{prefix}_adj_close"] = exit_price
                    call[f"{prefix}_return"] = exit_price / entry_price - 1.0
        if entry_status == "Pending - future market data":
            call["return_status"] = "Entry pending"
        elif entry_status.startswith("Excluded"):
            call["return_status"] = entry_status.removeprefix("Excluded - ").capitalize()
        elif call["m1_return"] is None:
            call["return_status"] = "1M & 3M pending"
        elif call["m3_return"] is None:
            call["return_status"] = "3M pending"
        else:
            call["return_status"] = "Complete"
        calls.append(call)
        if entry_status == "Included" and entry_date is not None and entry_date in qqq_calendar:
            events_by_date[entry_date].append(call)
        elif entry_status == "Pending - future market data":
            pending_calls.append(call)
    if not events_by_date:
        raise SystemExit("No call has an available next-trading-day entry")

    first_entry = min(events_by_date)
    calendar = qqq_calendar[qqq_calendar.get_loc(first_entry):]
    prices = prices.loc[calendar]
    qqq_nav = prices["QQQ"] / prices["QQQ"].iloc[0]
    qqq_returns = qqq_nav.pct_change().fillna(0.0)
    years = max((calendar[-1] - calendar[0]).days / 365.25, 1.0 / 365.25)

    frames = {}
    summaries = {}
    actions = {}
    for horizon in horizons:
        frame, extras, call_actions = run_strategy(calendar, prices, events_by_date, horizon, cost_rate)
        summaries[horizon] = {
            "gross": performance(frame["gross_nav"], frame["gross_nav"].pct_change().fillna(0.0), qqq_returns, years),
            "net": performance(frame["net_nav"], frame["daily_net_return"], qqq_returns, years),
            **extras,
            "annualized_turnover": extras["total_turnover"] / years,
        }
        frames[horizon] = frame
        actions[horizon] = call_actions
    qqq_summary = performance(qqq_nav, qqq_returns, qqq_returns, years)

    daily = []
    last_actual_date = calendar[-1]

    def pending_visible(current_date):
        return [
            call for call in pending_calls
            if pd.Timestamp(call["call_date"]) <= current_date
        ]

    def pending_due(current_date):
        return [
            call for call in pending_calls
            if pd.Timestamp(call["planned_entry_date"]) <= current_date
        ]

    def add_planned_fields(row, horizon: int, current_date, actual_row):
        prefix = f"h{horizon}"
        actual_names = {
            name.strip() for name in str(actual_row["active_tickers"]).split(",") if name.strip()
        }
        visible = pending_visible(current_date)
        due = pending_due(current_date)
        planned_names = sorted(actual_names | {call["ticker"] for call in due})
        planned_each, planned_cash = target_cash_for_names(planned_names)
        row[f"{prefix}_planned_active_count"] = len(planned_names)
        row[f"{prefix}_planned_invested_pct"] = 1.0 - planned_cash
        row[f"{prefix}_planned_cash_pct"] = planned_cash
        row[f"{prefix}_planned_tickers"] = ", ".join(planned_names)
        row[f"{prefix}_planned_positions"] = ", ".join(
            f"{ticker} {planned_each:.1%}" for ticker in planned_names
        )
        row[f"{prefix}_pending_calls"] = ", ".join(
            f"{call['ticker']} @ {call['planned_entry_date']}"
            + (" (due)" if pd.Timestamp(call["planned_entry_date"]) <= current_date else "")
            for call in visible
        )

    for current_date in calendar:
        row = {
            "date": current_date.strftime("%Y-%m-%d"),
            "data_status": "Observed close",
            "qqq_adj_close": float(prices.at[current_date, "QQQ"]),
            "qqq_nav": float(qqq_nav.loc[current_date]),
        }
        for horizon in horizons:
            current = frames[horizon].loc[current_date]
            prefix = f"h{horizon}"
            for field in ("gross_nav", "net_nav", "daily_net_return", "active_count", "invested_pct", "cash_pct", "turnover", "event", "active_tickers"):
                value = current[field]
                row[f"{prefix}_{field}"] = int(value) if field == "active_count" else (float(value) if field not in ("event", "active_tickers") else value)
            add_planned_fields(row, horizon, current_date, current)
        daily.append(row)

    # Keep the audit current even when Yahoo has not published today's close.
    # These rows carry the last realized NAV and expose planned calls separately;
    # they never manufacture a return or apply a future price.
    future_dates = list(pd.date_range(last_actual_date + pd.Timedelta(days=1), as_of, freq="B")) if as_of > last_actual_date else []
    if as_of > last_actual_date and as_of not in future_dates:
        future_dates.append(as_of)
    for current_date in sorted(set(future_dates)):
        row = {
            "date": current_date.strftime("%Y-%m-%d"),
            "data_status": "No Yahoo close; NAV carried forward",
            "qqq_adj_close": None,
            "qqq_nav": float(qqq_nav.iloc[-1]),
        }
        for horizon in horizons:
            actual = frames[horizon].iloc[-1]
            prefix = f"h{horizon}"
            row[f"{prefix}_gross_nav"] = float(actual["gross_nav"])
            row[f"{prefix}_net_nav"] = float(actual["net_nav"])
            row[f"{prefix}_daily_net_return"] = 0.0
            row[f"{prefix}_active_count"] = int(actual["active_count"])
            row[f"{prefix}_invested_pct"] = float(actual["invested_pct"])
            row[f"{prefix}_cash_pct"] = float(actual["cash_pct"])
            row[f"{prefix}_turnover"] = 0.0
            row[f"{prefix}_event"] = "No Yahoo close; realized NAV carried forward"
            row[f"{prefix}_active_tickers"] = actual["active_tickers"]
            add_planned_fields(row, horizon, current_date, actual)
        daily.append(row)

    for call in calls:
        for horizon in horizons:
            action = actions[horizon].get(call["call_id"])
            call[f"h{horizon}_action"] = action["action"] if action else None
            call[f"h{horizon}_expiry_date"] = action["expiry_date"] if action else None
            call[f"h{horizon}_remaining_sessions"] = action["remaining_sessions_after_history"] if action else None
            if action is None and call["entry_status"] == "Pending - future market data":
                call[f"h{horizon}_action"] = "Pending"
        call["status"] = call["entry_status"]

    monthly_frame = pd.DataFrame(daily)
    monthly_frame["month"] = monthly_frame["date"].str[:7]
    month_end = monthly_frame.groupby("month", sort=True).tail(1)
    chart_monthly = []
    for record in month_end.to_dict("records"):
        chart_monthly.append({
            "month": record["month"],
            f"h{horizons[0]}_net_nav": record[f"h{horizons[0]}_net_nav"],
            f"h{horizons[1]}_net_nav": record[f"h{horizons[1]}_net_nav"],
            "qqq_nav": record["qqq_nav"],
        })

    checks = {
        "all_entries_strictly_after_call": all(call["entry_date"] is None or call["entry_date"] > call["call_date"] for call in calls),
        "max_weight_at_or_below_20pct": all(summaries[horizon]["max_observed_weight"] <= 0.2000000001 for horizon in horizons),
        "cash_nonnegative": all(frames[horizon]["cash_pct"].min() >= -1e-10 for horizon in horizons),
        "navs_positive": all((frames[horizon][["gross_nav", "net_nav"]] > 0).all().all() for horizon in horizons),
        "signal_count_reconciles": len(calls) == len(signals),
        "daily_reaches_as_of": bool(daily) and daily[-1]["date"] >= as_of.strftime("%Y-%m-%d"),
        "pending_calls_have_no_realized_price": all(
            call["entry_status"] != "Pending - future market data" or call["entry_adj_close"] is None
            for call in calls
        ),
    }
    signals_by_file = defaultdict(int)
    for signal in signals:
        signals_by_file[signal["file"]] += 1
    reviewed_files = []
    for file_name in sorted(manifest.get("files", {}), key=lambda value: (value != "_INDEX.md", value)):
        date_match = re.match(r"^(\d{4}-\d{2}-\d{2})", file_name)
        reviewed_files.append({
            "date": date_match.group(1) if date_match else None,
            "edition": edition_from_file(file_name),
            "file": file_name,
            "review_status": "Reviewed - signal retained" if signals_by_file[file_name] else "Reviewed - no qualifying call",
            "signals_retained": signals_by_file[file_name],
            "source": source_url(source_dir, file_name),
            "sha256": manifest["files"][file_name],
        })

    checks["reviewed_file_count_reconciles"] = (
        len(reviewed_files) == len(manifest.get("files", {}))
        and {row["file"] for row in reviewed_files} == set(manifest.get("files", {}))
    )
    if not all(checks.values()):
        raise SystemExit(f"Backtest checks failed: {checks}")

    realized_m1 = [call["m1_return"] for call in calls if call["m1_return"] is not None]
    realized_m3 = [call["m3_return"] for call in calls if call["m3_return"] is not None]
    signal_return_summary = {
        "m1_average": sum(realized_m1) / len(realized_m1) if realized_m1 else None,
        "m1_calls": len(realized_m1),
        "m1_win_rate": sum(value > 0 for value in realized_m1) / len(realized_m1) if realized_m1 else None,
        "m3_average": sum(realized_m3) / len(realized_m3) if realized_m3 else None,
        "m3_calls": len(realized_m3),
        "m3_win_rate": sum(value > 0 for value in realized_m3) / len(realized_m3) if realized_m3 else None,
        "latest_yahoo_close": price_data_end.strftime("%Y-%m-%d"),
    }

    output = {
        "parameters": {
            "entry_rule": "First ticker trading close strictly after every call date",
            "repeat_call_rule": "Reset the holding period from the new next-day entry close",
            "rebalance_rule": "Rebalance after calls/resets, expiries, and any close where a position drifts above 20%",
            "weight_rule": "Equal weight across active unique tickers, capped at 20% each; residual in cash",
            "cash_return": 0.0,
            "cost_bps": args.cost_bps,
            "horizons": horizons,
            "benchmark": "QQQ adjusted-close buy and hold",
            "price_source": "Yahoo Finance via yfinance",
            "start_date": calendar[0].strftime("%Y-%m-%d"),
            "end_date": as_of.strftime("%Y-%m-%d"),
            "realized_end_date": calendar[-1].strftime("%Y-%m-%d"),
            "as_of_date": as_of.strftime("%Y-%m-%d"),
            "price_data_end_date": price_data_end.strftime("%Y-%m-%d"),
            "signals": len(signals),
            "reviewed_files": len(manifest.get("files", {})),
            "included_calls": sum(call["status"] == "Included" for call in calls),
            "pending_calls": sum(call["status"] == "Pending - future market data" for call in calls),
            "excluded_calls": sum(call["status"].startswith("Excluded") for call in calls),
            "failed_tickers": sorted(ticker for ticker in failed_tickers if ticker != "QQQ"),
        },
        "summary": {f"h{horizon}": summaries[horizon] for horizon in horizons} | {"qqq": qqq_summary},
        "daily": daily,
        "calls": calls,
        "signals": signals,
        "reviewed_files": reviewed_files,
        "signal_return_summary": signal_return_summary,
        "chart_monthly": chart_monthly,
        "checks": checks,
    }
    output_path = Path(args.output).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(output_path), "parameters": output["parameters"], "checks": checks}, indent=2))


if __name__ == "__main__":
    main()
