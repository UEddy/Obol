"""Model spend for a Hermes home, from Hermes's own token counts (state.db).

    python demo/capture/cost.py <HERMES_HOME> [budget_usd]

Prices per million tokens (Meta Muse, standard and contributor tiers); reasoning tokens are billed
as output. Exits 1 when the total is over the budget, so capture scripts can stop.
"""

import sqlite3
import sys

PRICES = {  # model prefix: (input, cached input, output) USD per million tokens
    "muse-spark-1.3-contributor": (0.10, 0.002, 0.20),
    "muse-spark-1.2-contributor": (0.10, 0.002, 0.20),
    "muse-spark": (1.25, 0.15, 4.25),
}


def price(model: str):
    for prefix in sorted(PRICES, key=len, reverse=True):
        if (model or "").startswith(prefix):
            return PRICES[prefix]
    return PRICES["muse-spark"]  # unknown: assume the standard tier (the expensive one)


def main() -> int:
    home = sys.argv[1]
    budget = float(sys.argv[2]) if len(sys.argv) > 2 else None
    c = sqlite3.connect(f"file:{home}/state.db?mode=ro", uri=True)
    rows = c.execute("SELECT model, SUM(input_tokens), SUM(cache_read_tokens), SUM(output_tokens), "
                     "SUM(reasoning_tokens) FROM session_model_usage GROUP BY model").fetchall()
    if not rows:
        rows = c.execute("SELECT model, SUM(input_tokens), SUM(cache_read_tokens), SUM(output_tokens), "
                         "SUM(reasoning_tokens) FROM sessions GROUP BY model").fetchall()
    total = 0.0
    for model, inp, cached, out, reasoning in rows:
        inp, cached, out, reasoning = (x or 0 for x in (inp, cached, out, reasoning))
        if not (model or "").startswith("muse"):
            print(f"{model}: not billed by Meta (skipped)")
            continue
        pin, pcache, pout = price(model)
        # Hermes's input_tokens already excludes cache reads, so all of it is charged at the full rate.
        cost = (inp * pin + cached * pcache + (out + reasoning) * pout) / 1e6
        total += cost
        print(f"{model}: in {inp:,} (cached {cached:,}), out {out:,} + reasoning {reasoning:,} -> ${cost:.4f}")
    print(f"TOTAL ${total:.4f}" + (f" of ${budget:.2f} budget" if budget else ""))
    return 1 if budget is not None and total > budget else 0


if __name__ == "__main__":
    raise SystemExit(main())
