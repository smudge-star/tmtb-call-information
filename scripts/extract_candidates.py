#!/usr/bin/env python3
"""Extract review candidates from newly changed TMTB Markdown files.

This helper is intentionally conservative.  It proposes sentences and ticker
tokens for the model/user to review; it never writes to the signal ledger.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path


STOP_TICKERS = {
    "A", "AM", "AN", "AND", "ARE", "AS", "AT", "BE", "BY", "CAN", "CEO",
    "CFO", "CO", "DO", "FOR", "FROM", "GDP", "GO", "HAS", "HAVE", "HE",
    "I", "IF", "IN", "IS", "IT", "ITS", "JUST", "KEY", "LET", "LONG",
    "ME", "MY", "NEW", "NO", "NOT", "OF", "ON", "OR", "OUR", "OUT", "PER",
    "Q", "R", "RE", "SEE", "SO", "THE", "THEM", "THIS", "TO", "UP", "US",
    "VERY", "WAS", "WE", "WHAT", "WHEN", "WHO", "WHY", "WITH", "YOU", "YOUR",
}

POSITIVE_PATTERNS = [
    (r"risk\s*/?\s*reward|risk[- ]reward", 5, "explicit risk/reward"),
    (r"set[- ]?up|setup", 4, "setup language"),
    (r"buy|bought|add(?:ed)?|own|hold|long|starter|initiat", 3, "position language"),
    (r"opportunit|attractive|compelling|interesting|favorite|favourite", 3, "opportunity language"),
    (r"upside|path of least resistance|skew|asymmetric|cheap|strong|good|great|nice", 2, "positive trade language"),
]


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sentence_parts(text: str) -> list[str]:
    # Keep Markdown markers in the quote so it remains an exact excerpt for
    # manage_state.py.  We only drop fenced code, which is not editorial text.
    clean = re.sub(r"```.*?```", " ", text, flags=re.DOTALL)
    parts = []
    for part in re.split(r"(?<=[.!?])\s+|\n+", clean):
        normalized = re.sub(r"\s+", " ", part).strip()
        if len(normalized) >= 20:
            parts.append(normalized)
    return parts


def ticker_tokens(sentence: str) -> list[str]:
    tokens: list[str] = []
    # Prefer explicit $TICKER forms, then all-caps symbols.  The review step
    # remains authoritative, so false positives are acceptable here.
    for token in re.findall(r"\$([A-Z][A-Z0-9.\-]{0,9})", sentence):
        if token not in STOP_TICKERS:
            tokens.append(token)
    for token in re.findall(r"(?<![A-Za-z])([A-Z][A-Z0-9.\-]{1,5})(?![A-Za-z])", sentence):
        if token not in STOP_TICKERS and token not in tokens:
            tokens.append(token)
    return tokens


def score_sentence(sentence: str) -> tuple[int, list[str]]:
    lowered = sentence.lower()
    score = 0
    reasons: list[str] = []
    for pattern, points, reason in POSITIVE_PATTERNS:
        if re.search(pattern, lowered):
            score += points
            reasons.append(reason)
    if re.search(r"\bnot\s+(?:a\s+)?(?:buy|long|good|great|attractive)|avoid|sell|short|bearish|downside", lowered):
        score -= 5
        reasons.append("negative/avoid language")
    return score, reasons


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", required=True)
    parser.add_argument("--pending-review", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    source_dir = Path(args.source_dir).resolve()
    pending = json.loads(Path(args.pending_review).read_text(encoding="utf-8"))
    candidates: list[dict] = []
    for item in pending.get("changed_files", []):
        relative = str(item["file"])
        path = source_dir / Path(relative)
        if not path.exists():
            continue
        raw = path.read_text(encoding="utf-8", errors="replace")
        for index, sentence in enumerate(sentence_parts(raw), start=1):
            tickers = ticker_tokens(sentence)
            if not tickers:
                continue
            score, reasons = score_sentence(sentence)
            if score <= 0:
                continue
            start = max(0, raw.find(sentence) - 180)
            context = re.sub(r"\s+", " ", raw[start : raw.find(sentence) + len(sentence) + 180]).strip()
            candidates.append({
                "file": relative,
                "sha256": item["sha256"],
                "status": item.get("status"),
                "sentence_index": index,
                "ticker_candidates": tickers,
                "sentence": sentence,
                "context": context,
                "score": score,
                "reasons": reasons,
            })
    candidates.sort(key=lambda row: (-row["score"], row["file"], row["sentence_index"]))
    output = {
        "version": 1,
        "pending_review": str(Path(args.pending_review).resolve()),
        "source_dir": str(source_dir),
        "changed_files": len(pending.get("changed_files", [])),
        "candidate_count": len(candidates),
        "candidates": candidates,
    }
    target = Path(args.output).resolve()
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(target), "changed_files": output["changed_files"], "candidate_count": len(candidates)}, indent=2))


if __name__ == "__main__":
    main()
