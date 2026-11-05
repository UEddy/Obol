"""Currency-aware conversion between human amounts and Stripe minor units."""

from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

# https://docs.stripe.com/currencies#zero-decimal
ZERO_DECIMAL = frozenset({
    "bif", "clp", "djf", "gnf", "jpy", "kmf", "krw", "mga", "pyg",
    "rwf", "ugx", "vnd", "vuv", "xaf", "xof", "xpf",
})
# Three-decimal currencies need amounts rounded to a multiple of 10 minor units; not supported.
THREE_DECIMAL = frozenset({"bhd", "jod", "kwd", "omr", "tnd"})

MAX_MINOR = 99_999_999  # Stripe's per-amount ceiling for most currencies (999,999.99 in 2-decimal)

_SYMBOLS = {"usd": "$", "eur": "€", "gbp": "£", "jpy": "¥", "cad": "CA$", "aud": "A$", "ngn": "₦", "inr": "₹"}


class MoneyError(ValueError):
    """An amount or currency the user gave cannot be invoiced."""


def normalize_currency(currency: object) -> str:
    if not isinstance(currency, str) or len(currency.strip()) != 3 or not currency.strip().isalpha():
        raise MoneyError(f"currency must be a 3-letter ISO code like 'usd', got {currency!r}")
    code = currency.strip().lower()
    if code in THREE_DECIMAL:
        raise MoneyError(f"{code.upper()} (three-decimal currency) is not supported yet")
    return code


def exponent(currency: str) -> int:
    return 0 if currency in ZERO_DECIMAL else 2


def to_minor(amount: object, currency: str) -> int:
    """``12.5`` USD -> ``1250``. Rejects non-positive, NaN, too many decimals and oversize amounts."""
    try:
        value = Decimal(str(amount).strip())
    except (InvalidOperation, AttributeError):
        raise MoneyError(f"amount must be a number, got {amount!r}") from None
    if not value.is_finite() or value <= 0:
        raise MoneyError(f"amount must be greater than zero, got {amount!r}")
    exp = exponent(currency)
    quantum = Decimal(1).scaleb(-exp)
    if value != value.quantize(quantum, rounding=ROUND_HALF_UP):
        raise MoneyError(f"{currency.upper()} amounts allow at most {exp} decimal places, got {amount!r}")
    minor = int((value * (10 ** exp)).to_integral_value())
    if minor > MAX_MINOR:
        raise MoneyError(f"amount {amount!r} exceeds Stripe's per-line maximum")
    return minor


def from_minor(minor: int, currency: str) -> Decimal:
    return Decimal(int(minor)).scaleb(-exponent(currency))


def fmt(minor: int, currency: str) -> str:
    """``(120000, 'usd')`` -> ``'$1,200.00'``; unknown symbols fall back to ``'1,200.00 SEK'``."""
    exp = exponent(currency)
    text = f"{from_minor(minor, currency):,.{exp}f}"
    symbol = _SYMBOLS.get(currency)
    return f"{symbol}{text}" if symbol else f"{text} {currency.upper()}"
