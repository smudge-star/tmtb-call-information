# Review schema and commands

`manage_state.py scan` writes a pending file with:

```json
{
  "changed_files": [
    {"file": "relative/name.md", "sha256": "...", "status": "new|changed", "absolute_path": "..."}
  ],
  "removed_files": ["relative/name.md"]
}
```

The review file passed to `manage_state.py apply` is:

```json
{
  "files": [
    {
      "file": "relative/name.md",
      "sha256": "the-current-hash-from-pending_review.json",
      "signals": [
        {
          "ticker": "AAPL",
          "quote": "Exact sentence from the file",
          "signal": "Short explanation of why it implies a favorable opportunity",
          "qualifier": "Risks, catalysts, valuation or timing qualifier"
        }
      ]
    }
  ],
  "removed_files": []
}
```

Use an empty `signals` list for a reviewed file with no qualifying call. Keep
only one signal per ticker per file. The apply command normalizes whitespace for
the quote check, validates ticker syntax, and rejects a file whose SHA-256 hash
changed during review.

Typical commands from the project root:

```powershell
python "$SKILL_ROOT\scripts\manage_state.py" bootstrap `
  --source-dir .\TMTB --state-dir .\.tmtb_portfolio_backtest `
  --asset-dir "$SKILL_ROOT\assets"

python "$SKILL_ROOT\scripts\refresh.py" `
  --project-root (Get-Location) --source-dir .\TMTB `
  --python-deps .\tmp\pydeps
```

When `refresh.py` finds new or changed Markdown files it also writes
`review_template.json`. Its `files` array is the authoritative checklist: the
review JSON must include exactly those files (including empty `signals` arrays)
and the exact SHA-256 values. After applying, `pending_review.json` must show
zero changed or removed files before a backtest workbook is generated.

The daily audit can extend beyond the last Yahoo close. Rows marked `No Yahoo
close; NAV carried forward` contain no fabricated price or return; planned
tickers, planned cash and pending entry dates are shown in separate columns.
