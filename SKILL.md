---
name: tmtb-portfolio-backtest
description: Refresh a reviewed TMTB stock-call ledger and create a dated Excel backtest versus QQQ. Use when the user asks for a daily TMTB portfolio refresh, a reproducible next-day-entry backtest, or a comparison of the TMTB call portfolio with QQQ.
---

# TMTB portfolio backtest

Use this skill from the workspace that contains `TMTB/`. It maintains a small,
auditable state directory and produces a new workbook on every successful run.
Never overwrite a prior workbook or the source mention workbook.

## Strategy definition

The backtest is deliberately mechanical:

- A call published in a Markdown filename is entered at the first trading close
  strictly after the call date. Same-day prices are never used.
- A repeated call for a ticker resets that ticker's holding-period clock from
  its new next-trading-day entry. It does not create a duplicate position.
- At a call/reset, expiry, or close where a position has drifted over 20%,
  rebalance to equal weights across active unique tickers, with each target
  weight `min(20%, 1 / active_tickers)`. The rest is cash earning 0%.
- The default horizons are 21 and 63 trading sessions. The default one-way
  turnover cost is 10 bps. Prices are Yahoo Finance adjusted closes loaded by
  `yfinance`; QQQ is adjusted-close buy-and-hold from the first strategy entry.
- Rebalance actions are applied after the day's close-to-close return and affect
  the next interval. The workbook includes a daily audit trail and call-level
  entry/expiry audit so look-ahead checks can be inspected.

The engine is `scripts/run_backtest.py`; it fails rather than silently writing a
workbook if its entry, weight, cash, signal-count, or NAV checks fail.

## Daily workflow

Set these paths explicitly when the workspace is not the current directory. The
skill root is the directory containing this `SKILL.md` file:

```text
PROJECT = the folder containing TMTB/
SOURCE  = PROJECT/TMTB
STATE   = PROJECT/.tmtb_portfolio_backtest
SKILL_ROOT = the directory containing this SKILL.md
```

1. On the first run, bootstrap the state from the supplied seed ledger and
   manifest. The seed contains the previously reviewed 118 signals and hashes
   for the existing Markdown files; this prevents a first daily run from asking
   the user to re-review the whole archive.

2. Scan the source folder:

   ```powershell
   python "$SKILL_ROOT\scripts\manage_state.py" scan `
     --source-dir "$SOURCE" --state-dir "$STATE" `
     --output "$STATE\pending_review.json"
   ```

   `pending_review.json` lists only new/changed files and removed files. When
   there are changed files, run `extract_candidates.py`, read every changed
   Markdown file in detail, and choose only ticker-specific sentences that
   clearly imply a favorable trading opportunity. The extractor is a shortlist,
   not an automatic classifier.

3. Create a review JSON with this shape (one strongest signal per ticker per
   file; an empty `signals` array means the file has no qualifying call):

   ```json
   {
     "files": [
       {
         "file": "2026-09-21 Morning Wrap.md",
         "sha256": "hash copied from pending_review.json",
         "signals": [
           {
             "ticker": "EXAMPLE",
             "quote": "an exact sentence copied from the Markdown file",
             "signal": "why this sentence is a favorable call",
             "qualifier": "risk, catalyst, or uncertainty mentioned by the author"
           }
         ]
       }
     ],
     "removed_files": []
   }
   ```

   Quotes must be exact after whitespace normalization. Apply the review with
   `manage_state.py apply`; it verifies the file hash and refuses stale or
   duplicate reviews. Use `apply_patch` when creating this JSON file.

4. Run the daily refresh. It re-downloads current Yahoo history even when no
   new calls were found and creates a new, timestamped workbook under
   `PROJECT/outputs/tmtb-daily-backtests/`:

   ```powershell
   python "$SKILL_ROOT\scripts\refresh.py" `
     --project-root "$PROJECT" --source-dir "$SOURCE" --state-dir "$STATE" `
     --python-deps "$PROJECT\tmp\pydeps"
   ```

   If the command reports `review_required`, complete the review JSON and rerun
   it with `--review-file PATH_TO_REVIEW.json`. Existing output files are never
   replaced; a numeric suffix is added if the same timestamp already exists.

## Review discipline

Read all changed files, not only the extractor output. Keep a signal only when
the sentence ties the favorable opinion to a specific ticker. Exclude general
market commentary, neutral descriptions, watchlists without an opportunity,
and sentences that are explicitly bearish/avoid/sell. Preserve the author's
qualifiers in the `qualifier` field. A ticker with no qualifying sentence is
valid and should be represented by an empty signal list for that file.

The state ledger is intentionally append/replace by file: when a Markdown file
changes, its old signals are removed and replaced by the newly reviewed set.
This makes edits and deletions reproducible and prevents stale calls from
surviving silently.

## Output checks

Open the generated workbook and inspect `Backtest`, `Backtest daily`, and the
call audit on the right side of `Backtest daily`. Confirm that:

- all included entry dates are after call dates;
- maximum observed weights are at or below 20% and cash is non-negative;
- the check block reports PASS;
- excluded Yahoo symbols (for example symbols with no usable history) are
  listed rather than treated as successful calls.

The output workbook retains the prior opportunity-review sheets and adds the
backtest summary, growth chart, daily NAV/cash/weight audit, and call-level
quote/entry/expiry audit. `references/review_schema.md` contains the exact
review schema and a compact command reference.
