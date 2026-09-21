# TMTB Portfolio Backtest

Reusable Codex skill for maintaining a reviewed TMTB stock-call ledger and
backtesting a next-trading-day portfolio against QQQ.

The strategy uses:

- next trading-day adjusted-close entry, with no same-day look-ahead;
- repeated-call holding-period resets;
- equal weighting across active unique tickers;
- a 20% maximum weight per ticker, with residual cash;
- 21- and 63-trading-day horizons by default;
- Yahoo Finance data through `yfinance`, with a daily audit trail.

## Install as a Codex skill

Copy this directory to the local skills directory as
`tmtb-portfolio-backtest`, then invoke it with:

```text
$tmtb-portfolio-backtest
```

The skill expects a workspace containing a `TMTB/` Markdown folder. It stores
review state in `.tmtb_portfolio_backtest/` and writes timestamped workbooks to
`outputs/tmtb-daily-backtests/`; those runtime files are intentionally ignored
by Git.

When Markdown files are new or changed, the skill asks for a review of those
files before replacing the signal ledger. It never silently accepts a new
signal.

See [SKILL.md](SKILL.md) for the complete workflow and review schema.
