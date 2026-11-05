"""Every security claim in the README names tests; this fails if a named test doesn't exist.

Parses `tests/<file>.py::<test>` references from README.md and checks each one is a real
top-level test function, and that every threat-model row names at least one.
"""

import ast
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
README = (ROOT / "README.md").read_text(encoding="utf-8")
REF = re.compile(r"`(tests/[\w/]+\.py)::(test_\w+)`")


def _tests_in(path: Path) -> set[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    return {n.name for n in tree.body if isinstance(n, ast.FunctionDef) and n.name.startswith("test_")}


def test_every_referenced_test_exists():
    refs = REF.findall(README)
    assert len(refs) >= 30
    missing = []
    for file, name in refs:
        path = ROOT / file
        if not path.exists() or name not in _tests_in(path):
            missing.append(f"{file}::{name}")
    assert not missing, f"README cites tests that don't exist: {missing}"


def test_every_threat_row_cites_a_test():
    section = README.split("## Threat model", 1)[1].split("### What Obol does not protect against", 1)[0]
    rows = [line for line in section.splitlines() if re.match(r"\|\s*[TG]\d+\s*\|", line)]
    assert len(rows) >= 15
    for row in rows:
        assert REF.search(row), f"threat-model row without a test: {row[:80]}"


def test_readme_keeps_its_honesty_section():
    assert "### What Obol does not protect against" in README
    assert "does not prevent all fraud" in README


# Hermes's install scanner treats these phrases as critical injection findings in any non-test file
# (README and docs included, even when quoted), which would fail catalog admission. Examples of
# attacks belong in tests/, where the scanner caps them.
_SCANNER_PHRASES = [
    r"ignore\s+(?:\w+\s+)*(previous|all|above|prior)\s+instructions",
    r"you\s+are\s+(?:\w+\s+)*now\s+",
    r"disregard\s+(?:\w+\s+)*(your|all|any)\s+(?:\w+\s+)*(instructions|rules|guidelines)",
    r"system\s+(?:\w+\s+)*prompt\s+(?:\w+\s+)*override",
    r"pretend\s+(?:\w+\s+)*(you\s+are|to\s+be)\s+",
    r"new\s+(?:\w+\s+)*policy|updated\s+(?:\w+\s+)*guidelines|revised\s+(?:\w+\s+)*instructions",
]
_SKIP = {"tests", "node_modules", ".git", "__pycache__", "out", "public"}


def test_no_scanner_injection_phrases_outside_tests():
    hits = []
    for path in ROOT.rglob("*"):
        rel = path.relative_to(ROOT)
        if path.is_dir() or _SKIP.intersection(rel.parts) or path.suffix in {".png", ".mp4", ".jpg", ".ico", ".lock"}:
            continue
        if path.name == "package-lock.json":
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        for rx in _SCANNER_PHRASES:
            for m in re.finditer(rx, text, re.I):
                hits.append(f"{rel}: {m.group(0)[:50]!r}")
    assert not hits, hits
