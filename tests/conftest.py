from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from fake_stripe import FakeStripe  # noqa: E402
from obol_lib.store import Store  # noqa: E402
from obol_lib.stripe_client import StripeClient  # noqa: E402


@pytest.fixture
def fake():
    return FakeStripe()


@pytest.fixture
def client(fake):
    with StripeClient("sk_test_123", transport=fake.transport, sleep=lambda _s: None) as c:
        yield c


@pytest.fixture
def store():
    return Store.memory()
