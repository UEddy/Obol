"""Demo-only stand-in for the OpenClawCash backend, so the Guard beat runs without a real wallet account.

capture.sh installs this into the demo Hermes home as the plugin `obol_demo_wallet_stub`. It swaps the
agentwalletapi plugin's HTTP opener (its only network path, the same seam tests/test_guard_real_plugin.py
uses) for canned responses: one wallet, `wal_main`, holding test USDC. Nothing leaves the machine and no
funds exist. The agentwalletapi plugin itself and Obol Guard's interception run unmodified.
"""

import json
import sys

WALLETS = [{"walletId": "wal_main", "label": "Main", "chain": "evm", "address": "0x3C9e5B1aD27f0E84c6A9b2D1F5e7C0a4B8d6E2f1",
            "balances": [{"token": "USDC", "amountDisplay": "2400.00"}]}]


class _Resp:
    def __init__(self, body):
        self._b = json.dumps(body).encode()

    def read(self):
        return self._b

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class _Opener:
    def open(self, request, timeout=None):
        path = request.full_url.split("openclawcash.com", 1)[-1].split("?", 1)[0]
        body = json.loads(request.data.decode()) if request.data else {}
        if path == "/api/agent/wallets":
            return _Resp({"wallets": WALLETS})
        if path == "/api/agent/wallet":
            return _Resp(WALLETS[0])
        if path == "/api/agent/transfer":
            return _Resp({"status": "submitted", "txHash": "0xdemo", **body})
        return _Resp({"message": "not available in the demo stub"})


def _patch(**_):
    for name, mod in list(sys.modules.items()):
        if name.endswith("agentwalletapi.api_client") and not isinstance(getattr(mod, "_opener", None), _Opener):
            mod._opener = _Opener()
    return None


def register(ctx):
    _patch()
    ctx.register_hook("pre_tool_call", _patch)
