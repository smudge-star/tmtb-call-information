#!/usr/bin/env python3
"""Refresh TMTB state, run the Yahoo Finance backtest, and build a dated workbook.

The command stops with exit code 2 when new/changed Markdown files need review.
The calling skill/model should inspect the candidate JSON, create a review JSON,
and rerun with --review-file.  Existing workbooks are never overwritten.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path


def run(command: list[str], *, check: bool = True) -> subprocess.CompletedProcess:
    result = subprocess.run(command, text=True, capture_output=True, encoding="utf-8", errors="replace")
    if check and result.returncode != 0:
        raise RuntimeError(
            f"Command failed ({result.returncode}): {' '.join(command)}\nSTDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}"
        )
    return result


def json_from_stdout(result: subprocess.CompletedProcess) -> dict:
    lines = [line.strip() for line in result.stdout.splitlines() if line.strip()]
    for line in reversed(lines):
        try:
            value = json.loads(line)
            if isinstance(value, dict):
                return value
        except json.JSONDecodeError:
            continue
    return {}


def find_node(explicit: str | None) -> str:
    if explicit:
        return explicit
    found = shutil.which("node")
    if found:
        return found
    home = Path.home()
    candidates = [
        home / ".cache" / "codex-runtimes" / "codex-primary-runtime" / "dependencies" / "node" / "bin" / "node.exe",
        home / ".cache" / "codex-runtimes" / "codex-primary-runtime" / "dependencies" / "node" / "bin" / "node",
    ]
    for candidate in candidates:
        if candidate.exists():
            return str(candidate)
    raise RuntimeError("Node.js was not found; pass --node with the bundled Node executable")


def find_marker() -> Path | None:
    home = Path.home()
    roots = [
        home / ".codex" / "plugins" / "cache" / "openai-primary-runtime" / "spreadsheets",
        home / ".codex" / "plugins" / "cache" / "openai-bundled" / "spreadsheets",
    ]
    for root in roots:
        matches = sorted(root.glob("*/skills/spreadsheets/container_tools/mark_artifact_operation_started.mjs"))
        if matches:
            return matches[-1]
    return None


def unique_path(directory: Path, stem: str, suffix: str) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    candidate = directory / f"{stem}{suffix}"
    index = 2
    while candidate.exists():
        candidate = directory / f"{stem}_{index}{suffix}"
        index += 1
    return candidate


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project-root", default=".")
    parser.add_argument("--source-dir")
    parser.add_argument("--state-dir")
    parser.add_argument("--asset-dir")
    parser.add_argument("--template")
    parser.add_argument("--output-dir")
    parser.add_argument("--review-file")
    parser.add_argument("--python-deps")
    parser.add_argument("--node")
    parser.add_argument("--artifact-tool", help="Path to artifact_tool.mjs when the skill is outside the project's node_modules tree")
    parser.add_argument("--horizons", nargs=2, type=int, default=[21, 63])
    parser.add_argument("--cost-bps", type=float, default=10.0)
    parser.add_argument("--skip-scan", action="store_true", help="Use the existing pending_review.json and do not rescan")
    args = parser.parse_args()

    project_root = Path(args.project_root).resolve()
    source_dir = Path(args.source_dir).resolve() if args.source_dir else project_root / "TMTB"
    skill_dir = Path(__file__).resolve().parent.parent
    state_dir = Path(args.state_dir).resolve() if args.state_dir else project_root / ".tmtb_portfolio_backtest"
    asset_dir = Path(args.asset_dir).resolve() if args.asset_dir else skill_dir / "assets"
    template = Path(args.template).resolve() if args.template else project_root / "outputs" / "tmtb-opportunity-review" / "TMTB_stock_opportunity_mentions_2024_to_present.xlsx"
    output_dir = Path(args.output_dir).resolve() if args.output_dir else project_root / "outputs" / "tmtb-daily-backtests"
    state_dir.mkdir(parents=True, exist_ok=True)
    manage = skill_dir / "scripts" / "manage_state.py"
    extract = skill_dir / "scripts" / "extract_candidates.py"
    backtest = skill_dir / "scripts" / "run_backtest.py"
    builder = skill_dir / "scripts" / "build_workbook.mjs"

    if not (state_dir / "signals.json").exists() or not (state_dir / "reviewed_manifest.json").exists():
        bootstrap = run([sys.executable, str(manage), "bootstrap", "--source-dir", str(source_dir), "--state-dir", str(state_dir), "--asset-dir", str(asset_dir)])
    else:
        bootstrap = None

    pending_path = state_dir / "pending_review.json"
    if not args.skip_scan:
        scan = run([sys.executable, str(manage), "scan", "--source-dir", str(source_dir), "--state-dir", str(state_dir), "--output", str(pending_path)])
    else:
        scan = None
    pending = json.loads(pending_path.read_text(encoding="utf-8")) if pending_path.exists() else {"changed_files": [], "removed_files": []}
    changed = pending.get("changed_files", [])
    removed = pending.get("removed_files", [])

    candidate_path = state_dir / "candidate_review.json"
    if changed:
        run([sys.executable, str(extract), "--source-dir", str(source_dir), "--pending-review", str(pending_path), "--output", str(candidate_path)])
    review_template_path = state_dir / "review_template.json"
    if changed or removed:
        review_template = {
            "files": [
                {"file": item["file"], "sha256": item["sha256"], "signals": []}
                for item in changed
            ],
            "removed_files": removed,
        }
        review_template_path.write_text(json.dumps(review_template, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    review_file = Path(args.review_file).resolve() if args.review_file else None
    if (changed or removed) and review_file is None:
        print(json.dumps({
            "status": "review_required",
            "state_dir": str(state_dir),
            "pending_review": str(pending_path),
            "candidate_review": str(candidate_path) if changed else None,
            "review_template": str(review_template_path) if (changed or removed) else None,
            "new_files": sum(item.get("status") == "new" for item in changed),
            "changed_files": sum(item.get("status") == "changed" for item in changed),
            "removed_files": len(removed),
            "next_step": "Review candidates and rerun with --review-file REVIEW.json",
        }, indent=2))
        raise SystemExit(2)

    if review_file is not None:
        review_payload = json.loads(review_file.read_text(encoding="utf-8"))
        expected_files = {item["file"] for item in changed}
        reviewed_files = {str(item.get("file", "")) for item in review_payload.get("files", [])}
        if reviewed_files != expected_files:
            missing = sorted(expected_files - reviewed_files)
            extra = sorted(reviewed_files - expected_files)
            raise RuntimeError(f"Review must include exactly the current changed files; missing={missing}, extra={extra}")
        if set(review_payload.get("removed_files", [])) != set(removed):
            raise RuntimeError(
                f"Review removed_files must match pending_review.json; expected={sorted(removed)}, got={sorted(review_payload.get('removed_files', []))}"
            )
        run([sys.executable, str(manage), "apply", "--source-dir", str(source_dir), "--state-dir", str(state_dir), "--review-file", str(review_file)])
        run([sys.executable, str(manage), "scan", "--source-dir", str(source_dir), "--state-dir", str(state_dir), "--output", str(pending_path)])
        pending = json.loads(pending_path.read_text(encoding="utf-8"))
        if pending.get("changed_files") or pending.get("removed_files"):
            raise RuntimeError(f"Review did not reconcile the changed-file manifest: {pending}")

    if not template.exists():
        raise RuntimeError(f"Template workbook not found: {template}")

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backtest_json = state_dir / f"backtest_{timestamp}.json"
    signals = state_dir / "signals.json"
    manifest = state_dir / "reviewed_manifest.json"
    backtest_result = run([
        sys.executable, str(backtest),
        "--project-root", str(project_root), "--source-dir", str(source_dir), "--state-dir", str(state_dir),
        "--signals", str(signals), "--manifest", str(manifest), "--output", str(backtest_json),
        "--horizons", str(args.horizons[0]), str(args.horizons[1]), "--cost-bps", str(args.cost_bps),
        *( ["--python-deps", str(Path(args.python_deps).resolve())] if args.python_deps else [] ),
    ])

    workbook_path = unique_path(output_dir, f"TMTB_portfolio_backtest_{timestamp}", ".xlsx")
    marker = find_marker()
    if marker:
        run([find_node(args.node), str(marker), "--operation-kind", "create", "--expected-output-count", "1", "--output-format", "xlsx"])
    node = find_node(args.node)
    artifact_tool = Path(args.artifact_tool).resolve() if args.artifact_tool else project_root / "tmp" / "node_modules" / "@oai" / "artifact-tool" / "dist" / "artifact_tool.mjs"
    build_command = [node, str(builder), "--template", str(template), "--data", str(backtest_json), "--output", str(workbook_path)]
    if artifact_tool.exists():
        build_command.extend(["--artifact-tool", str(artifact_tool)])
    build_result = run(build_command)
    parsed_backtest = json.loads(backtest_json.read_text(encoding="utf-8"))
    parsed_build = json_from_stdout(build_result)
    print(json.dumps({
        "status": "complete",
        "workbook": str(workbook_path),
        "backtest_json": str(backtest_json),
        "state_dir": str(state_dir),
        "candidate_review": str(candidate_path) if candidate_path.exists() else None,
        "review_template": str(review_template_path) if review_template_path.exists() else None,
        "reviewed_files": len(json.loads((state_dir / "reviewed_manifest.json").read_text(encoding="utf-8")).get("files", {})),
        "checks": parsed_backtest.get("checks") or parsed_build.get("checks"),
        "parameters": parsed_backtest.get("parameters"),
    }, indent=2))


if __name__ == "__main__":
    main()
