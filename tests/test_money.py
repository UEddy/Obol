import pytest

from obol_lib import money


@pytest.mark.parametrize("amount,currency,expected", [
    (12.5, "usd", 1250), ("1200", "usd", 120000), ("0.01", "eur", 1), (5000, "jpy", 5000), ("19.99", "gbp", 1999),
])
def test_to_minor(amount, currency, expected):
    assert money.to_minor(amount, currency) == expected


@pytest.mark.parametrize("amount,currency", [
    (0, "usd"), (-5, "usd"), ("abc", "usd"), (float("nan"), "usd"), ("1.001", "usd"), ("10.5", "jpy"),
    (10_000_000, "usd"), (None, "usd"),
])
def test_to_minor_rejects(amount, currency):
    with pytest.raises(money.MoneyError):
        money.to_minor(amount, currency)


def test_currency_validation():
    assert money.normalize_currency(" USD ") == "usd"
    for bad in ("us", "dollars", 123, None, "kwd"):
        with pytest.raises(money.MoneyError):
            money.normalize_currency(bad)


def test_fmt():
    assert money.fmt(120000, "usd") == "$1,200.00"
    assert money.fmt(5000, "jpy") == "¥5,000"
    assert money.fmt(1999, "sek") == "19.99 SEK"
