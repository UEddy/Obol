"""Obol core: Stripe invoicing logic shared by the Hermes tools and the dashboard backend.

Nothing in this package imports Hermes at module import time, so it can be unit-tested with
plain pytest and loaded from ``dashboard/plugin_api.py`` without the plugin package.
"""

__version__ = "0.1.0"
