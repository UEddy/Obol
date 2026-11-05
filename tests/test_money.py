import pytest

from obol_lib import money


@pytest.mark.parametrize("amount,expected", [(12.5, 1250), ("1200", 120000), ("0.01", 1), ("19.99", 1999), (950, 95000)])
def test_to_minor_usd(amount, expected):
    assert money.to_minor(amount, "usd") == expected


@pytest.mark.parametrize("amount", [0, -5, "abc", float("nan"), "1.001", 10_000_000, None, float("inf")])
def test_to_minor_rejects(amount):
    with pytest.raises(money.MoneyError):
        money.to_minor(amount, "usd")


def test_currency_validation():
    assert money.normalize_currency(" USD ") == "usd"
    for bad in ("us", "dollars", 123, None, ""):
        with pytest.raises(money.MoneyError):
            money.normalize_currency(bad)


def test_fmt_usd():
    assert money.fmt(120000, "usd") == "$1,200.00"
    assert money.fmt(1, "usd") == "$0.01"
