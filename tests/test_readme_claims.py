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
    rows = [line for line in section.splitlines() if re.match(r"\|\s*T\d+\s*\|", line)]
    assert len(rows) >= 15
    for row in rows:
        assert REF.search(row), f"threat-model row without a test: {row[:80]}"


def test_readme_keeps_its_honesty_section():
    assert "### What Obol does not protect against" in README
    assert "does not prevent all fraud" in README
