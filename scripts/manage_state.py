#!/usr/bin/env python3
"""Maintain the reviewed-file manifest and curated TMTB signal ledger."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path


REQUIRED_SIGNAL_FIELDS = ("ticker", "quote", "signal", "qualifier")


def read_json(path: Path, default):
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def source_files(source_dir: Path) -> dict[str, Path]:
    return {
        path.relative_to(source_dir).as_posix(): path
        for path in sorted(source_dir.rglob("*.md"))
        if path.is_file()
    }


def normalized_text(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def command_seed(args) -> None:
    source_dir = Path(args.source_dir).resolve()
    asset_dir = Path(args.asset_dir).resolve()
    signals_path = Path(args.signals).resolve()
    files = source_files(source_dir)
    manifest = {
        "version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "files": {name: sha256(path) for name, path in files.items()},
    }
    asset_dir.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(signals_path, asset_dir / "signals_seed.json")
    write_json(asset_dir / "reviewed_manifest_seed.json", manifest)
    print(json.dumps({"signals": len(read_json(signals_path, [])), "files": len(files), "asset_dir": str(asset_dir)}, indent=2))


def command_bootstrap(args) -> None:
    source_dir = Path(args.source_dir).resolve()
    state_dir = Path(args.state_dir).resolve()
    asset_dir = Path(args.asset_dir).resolve()
    state_dir.mkdir(parents=True, exist_ok=True)
    signals_path = state_dir / "signals.json"
    manifest_path = state_dir / "reviewed_manifest.json"
    if not signals_path.exists():
        seed_signals = read_json(asset_dir / "signals_seed.json", [])
        existing = set(source_files(source_dir))
        seed_signals = [row for row in seed_signals if row.get("file") in existing]
        write_json(signals_path, seed_signals)
    if not manifest_path.exists():
        seed = read_json(asset_dir / "reviewed_manifest_seed.json", {"version": 1, "files": {}})
        write_json(manifest_path, seed)
    print(json.dumps({
        "state_dir": str(state_dir),
        "signals": len(read_json(signals_path, [])),
        "reviewed_files": len(read_json(manifest_path, {}).get("files", {})),
    }, indent=2))


def command_scan(args) -> None:
    source_dir = Path(args.source_dir).resolve()
    state_dir = Path(args.state_dir).resolve()
    manifest = read_json(state_dir / "reviewed_manifest.json", {"version": 1, "files": {}})
    prior = manifest.get("files", {})
    files = source_files(source_dir)
    current = {name: sha256(path) for name, path in files.items()}
    changed = []
    for name, digest in current.items():
        old = prior.get(name)
        if old != digest:
            changed.append({
                "file": name,
                "sha256": digest,
                "status": "new" if old is None else "changed",
                "absolute_path": str(files[name]),
            })
    removed = sorted(set(prior) - set(current))
    pending = {
        "version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source_dir": str(source_dir),
        "changed_files": changed,
        "removed_files": removed,
        "current_file_count": len(current),
    }
    output = Path(args.output).resolve() if args.output else state_dir / "pending_review.json"
    write_json(output, pending)
    print(json.dumps({
        "pending_review": str(output),
        "new_files": sum(row["status"] == "new" for row in changed),
        "changed_files": sum(row["status"] == "changed" for row in changed),
        "removed_files": len(removed),
        "current_file_count": len(current),
    }, indent=2))


def validate_signal(signal: dict, file_name: str, raw_text: str) -> dict:
    missing = [field for field in REQUIRED_SIGNAL_FIELDS if not str(signal.get(field, "")).strip()]
    if missing:
        raise ValueError(f"{file_name}: signal is missing {', '.join(missing)}")
    ticker = str(signal["ticker"]).strip().upper()
    if not re.fullmatch(r"[A-Z][A-Z0-9.\-]{0,9}", ticker):
        raise ValueError(f"{file_name}: invalid ticker {ticker!r}")
    quote = normalized_text(str(signal["quote"]))
    if quote not in normalized_text(raw_text):
        raise ValueError(f"{file_name}: quote is not an exact whitespace-normalized excerpt")
    return {
        "ticker": ticker,
        "file": file_name,
        "quote": quote,
        "signal": normalized_text(str(signal["signal"])),
        "qualifier": normalized_text(str(signal["qualifier"])),
    }


def command_apply(args) -> None:
    source_dir = Path(args.source_dir).resolve()
    state_dir = Path(args.state_dir).resolve()
    review = read_json(Path(args.review_file).resolve(), {})
    manifest_path = state_dir / "reviewed_manifest.json"
    signals_path = state_dir / "signals.json"
    manifest = read_json(manifest_path, {"version": 1, "files": {}})
    signals = read_json(signals_path, [])
    files = source_files(source_dir)

    reviewed_names = set()
    replacement_signals = []
    for item in review.get("files", []):
        name = str(item.get("file", ""))
        if name in reviewed_names:
            raise ValueError(f"duplicate reviewed file: {name}")
        reviewed_names.add(name)
        if name not in files:
            raise ValueError(f"reviewed file no longer exists: {name}")
        actual_hash = sha256(files[name])
        if item.get("sha256") != actual_hash:
            raise ValueError(f"file changed during review: {name}")
        raw = files[name].read_text(encoding="utf-8")
        seen_tickers = set()
        for signal in item.get("signals", []):
            validated = validate_signal(signal, name, raw)
            if validated["ticker"] in seen_tickers:
                raise ValueError(f"{name}: keep only the strongest signal per ticker")
            seen_tickers.add(validated["ticker"])
            replacement_signals.append(validated)
        manifest.setdefault("files", {})[name] = actual_hash

    removed_names = set(review.get("removed_files", []))
    for name in removed_names:
        if name in files:
            raise ValueError(f"removed file still exists: {name}")
        manifest.setdefault("files", {}).pop(name, None)

    replace_names = reviewed_names | removed_names
    signals = [row for row in signals if row.get("file") not in replace_names]
    signals.extend(replacement_signals)
    signals.sort(key=lambda row: (row.get("file", ""), row.get("ticker", ""), row.get("quote", "")))
    manifest["generated_at"] = datetime.now(timezone.utc).isoformat()
    write_json(signals_path, signals)
    write_json(manifest_path, manifest)
    print(json.dumps({
        "reviewed_files_applied": len(reviewed_names),
        "removed_files_applied": len(removed_names),
        "new_signals_in_review": len(replacement_signals),
        "total_signals": len(signals),
        "total_reviewed_files": len(manifest.get("files", {})),
    }, indent=2))


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    sub = result.add_subparsers(dest="command", required=True)

    seed = sub.add_parser("seed")
    seed.add_argument("--source-dir", required=True)
    seed.add_argument("--signals", required=True)
    seed.add_argument("--asset-dir", required=True)
    seed.set_defaults(func=command_seed)

    bootstrap = sub.add_parser("bootstrap")
    bootstrap.add_argument("--source-dir", required=True)
    bootstrap.add_argument("--state-dir", required=True)
    bootstrap.add_argument("--asset-dir", required=True)
    bootstrap.set_defaults(func=command_bootstrap)

    scan = sub.add_parser("scan")
    scan.add_argument("--source-dir", required=True)
    scan.add_argument("--state-dir", required=True)
    scan.add_argument("--output")
    scan.set_defaults(func=command_scan)

    apply_review = sub.add_parser("apply")
    apply_review.add_argument("--source-dir", required=True)
    apply_review.add_argument("--state-dir", required=True)
    apply_review.add_argument("--review-file", required=True)
    apply_review.set_defaults(func=command_apply)
    return result


if __name__ == "__main__":
    arguments = parser().parse_args()
    arguments.func(arguments)
