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


def settings_from(getter: Callable[[str, Any], Any]) -> Settings:
    """Build Settings from a ``(key, default) -> value`` getter, coercing bad values to defaults."""
    d = Settings()
    approval = getter("approval", d.approval)
    days = getter("default_days_until_due", d.default_days_until_due)
    try:
        days = int(days)
    except (TypeError, ValueError):
        days = d.default_days_until_due
    currency = getter("default_currency", d.default_currency)
    return Settings(
        default_currency=currency if isinstance(currency, str) and len(currency) == 3 else d.default_currency,
        default_days_until_due=days if 0 <= days <= 365 else d.default_days_until_due,
        approval=approval if approval in ("always", "live_only", "never") else d.approval,
        allow_live=getter("allow_live", d.allow_live) is True,
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


def make_client(settings: Settings, key: Optional[str] = None) -> StripeClient:
    return client_factory(key if key is not None else api_key(), allow_live=settings.allow_live)


def store() -> Store:
    from plugins.plugin_storage import plugin_data_dir, plugin_db
    data_dir = str(plugin_data_dir(PLUGIN_NAME))  # follows the active profile
    with _stores_lock:
        st = _stores.get(data_dir)
        if st is None:
            st = _stores[data_dir] = Store(plugin_db(PLUGIN_NAME))
        return st
