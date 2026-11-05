"""Hermes-facing plumbing: settings, credentials and the per-profile store.

Hermes modules are imported lazily inside functions so the rest of obol_lib stays importable
(and testable) without Hermes.
"""

from __future__ import annotations

import threading
from typing import Any, Callable, Mapping, Optional

from .service import Settings
from .store import Store
from .stripe_client import StripeClient

PLUGIN_NAME = "obol"
KEY_ENV = "STRIPE_API_KEY"

_stores: dict[str, Store] = {}
_stores_lock = threading.Lock()

# Tests replace this to route every client through a fake transport.
client_factory: Callable[..., StripeClient] = StripeClient


def _number(getter: Callable[[str, Any], Any], key: str, default: Any, lo: float, hi: float, cast: type) -> Any:
    try:
        value = cast(getter(key, default))
    except (TypeError, ValueError):
        return default
    return value if lo <= value <= hi else default


def settings_from(getter: Callable[[str, Any], Any]) -> Settings:
    """Build Settings from a ``(key, default) -> value`` getter, coercing bad values to defaults."""
    d = Settings()
    currency = getter("default_currency", d.default_currency)
    return Settings(
        default_currency=currency.lower() if isinstance(currency, str) and len(currency) == 3 else d.default_currency,
        default_days_until_due=_number(getter, "default_days_until_due", d.default_days_until_due, 0, 365, int),
        allow_live=getter("allow_live", d.allow_live) is True,
        risk_duplicate_window_days=_number(getter, "risk_duplicate_window_days", d.risk_duplicate_window_days, 0, 365, int),
        risk_amount_multiplier=_number(getter, "risk_amount_multiplier", d.risk_amount_multiplier, 0, 1000, float),
        risk_amount_min_history=_number(getter, "risk_amount_min_history", d.risk_amount_min_history, 1, 100, int),
        risk_contact_change_days=_number(getter, "risk_contact_change_days", d.risk_contact_change_days, 0, 30, int),
    )


def settings_from_config(config: Mapping[str, Any]) -> Settings:
    """Settings from a full Hermes config dict (``plugins.entries.obol.settings``)."""
    node: Any = config
    for part in ("plugins", "entries", PLUGIN_NAME, "settings"):
        node = node.get(part) if isinstance(node, Mapping) else None
    node = node if isinstance(node, Mapping) else {}
    return settings_from(lambda k, default: node.get(k, default))


def api_key() -> Optional[str]:
    from agent.secret_scope import get_secret  # Hermes's profile-aware credential route
    return get_secret(KEY_ENV)


def make_client(settings: Settings, key: Optional[str] = None, **kwargs: Any) -> StripeClient:
    return client_factory(key if key is not None else api_key(), allow_live=settings.allow_live, **kwargs)


def store() -> Store:
    from plugins.plugin_storage import plugin_data_dir, plugin_db
    data_dir = str(plugin_data_dir(PLUGIN_NAME))  # follows the active profile
    with _stores_lock:
        st = _stores.get(data_dir)
        if st is None:
            st = _stores[data_dir] = Store(plugin_db(PLUGIN_NAME))
        return st
