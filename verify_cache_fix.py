#!/usr/bin/env python3
"""
Verify that the cache price fallback fix works correctly.

This script reads raw token data from the database, recalculates costs
using BOTH the old logic (cache defaults to $0) and the new fix
(cache defaults to input/output price), and compares results.
"""

import sqlite3
import json
import os
from collections import defaultdict

DB_PATH = os.path.expanduser("~/.local/share/opencode/opencode.db")

# Pricing from models.dev for openrouter/xiaomi/mimo-v2-pro
# Note: models.dev does NOT include cache_read for this model!
MODEL_PRICES = {
    "openrouter/xiaomi/mimo-v2-pro": {
        "input": 1.0,
        "output": 3.0,
        # cache_read is MISSING from models.dev — this is the bug
        # cache_write is also MISSING
    },
}


def calc_cost_old(tokens, prices):
    """OLD behavior: missing cache prices default to $0"""
    input_cost = tokens["input"] * prices["input"] / 1_000_000
    output_cost = tokens["output"] * prices["output"] / 1_000_000
    cache_read_cost = tokens["cache_read"] * 0 / 1_000_000  # DEFAULTS TO 0!
    cache_write_cost = tokens["cache_write"] * 0 / 1_000_000  # DEFAULTS TO 0!
    reasoning_cost = tokens["reasoning"] * prices["output"] / 1_000_000
    return input_cost + output_cost + cache_read_cost + cache_write_cost + reasoning_cost


def calc_cost_fixed(tokens, prices):
    """FIXED behavior: missing cache prices default to input/output"""
    input_cost = tokens["input"] * prices["input"] / 1_000_000
    output_cost = tokens["output"] * prices["output"] / 1_000_000
    # FIX: cache_read falls back to input price, cache_write falls back to output price
    cache_read_price = prices.get("cache_read", prices["input"])  # <-- THE FIX
    cache_write_price = prices.get("cache_write", prices["output"])  # <-- THE FIX
    cache_read_cost = tokens["cache_read"] * cache_read_price / 1_000_000
    cache_write_cost = tokens["cache_write"] * cache_write_price / 1_000_000
    reasoning_cost = tokens["reasoning"] * prices["output"] / 1_000_000
    return input_cost + output_cost + cache_read_cost + cache_write_cost + reasoning_cost


def verify():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("""
        SELECT m.data
        FROM message m
        WHERE json_extract(m.data, '$.role') = 'assistant'
        ORDER BY m.time_created
    """)
    rows = cursor.fetchall()
    conn.close()

    results = defaultdict(lambda: {
        "count": 0,
        "stored_total": 0,
        "old_calc_total": 0,
        "fixed_calc_total": 0,
        "tokens": {"input": 0, "output": 0, "reasoning": 0, "cache_read": 0, "cache_write": 0},
    })

    print("=" * 80)
    print("VERIFICATION: Cache Price Fallback Fix")
    print("=" * 80)
    print()

    for row in rows:
        data = json.loads(row[0])
        provider = data.get("providerID", "unknown")
        model = data.get("modelID", "unknown")
        stored_cost = data.get("cost", 0)
        tokens_raw = data.get("tokens", {})

        if not isinstance(tokens_raw, dict):
            continue

        tokens = {
            "input": tokens_raw.get("input", 0),
            "output": tokens_raw.get("output", 0),
            "reasoning": tokens_raw.get("reasoning", 0),
            "cache_read": tokens_raw.get("cache", {}).get("read", 0),
            "cache_write": tokens_raw.get("cache", {}).get("write", 0),
        }

        model_key = f"{provider}/{model}"
        prices = MODEL_PRICES.get(model_key)
        if prices is None:
            continue

        old_cost = calc_cost_old(tokens, prices)
        fixed_cost = calc_cost_fixed(tokens, prices)

        r = results[model_key]
        r["count"] += 1
        r["stored_total"] += stored_cost
        r["old_calc_total"] += old_cost
        r["fixed_calc_total"] += fixed_cost
        for k in r["tokens"]:
            r["tokens"][k] += tokens[k]

    # Print results
    for model_key, r in sorted(results.items(), key=lambda x: x[1]["fixed_calc_total"], reverse=True):
        print(f"\n{model_key}")
        print(f"  Messages: {r['count']}")
        t = r["tokens"]
        print(f"  Tokens: input={t['input']:,} output={t['output']:,} reasoning={t['reasoning']:,} "
              f"cache_read={t['cache_read']:,} cache_write={t['cache_write']:,}")
        print(f"  Stored cost (database):     ${r['stored_total']:.6f}")
        print(f"  OLD calc (cache=$0):        ${r['old_calc_total']:.6f}")
        print(f"  FIXED calc (cache=input/out): ${r['fixed_calc_total']:.6f}")

        undercharge = r["stored_total"] - r["fixed_calc_total"]
        old_vs_fixed = r["fixed_calc_total"] - r["old_calc_total"]
        print(f"  Undercharge vs fix:         ${undercharge:+.6f}")
        print(f"  Fix increase vs old:        ${old_vs_fixed:+.6f} ({old_vs_fixed/r['old_calc_total']*100:.0f}%)" if r['old_calc_total'] > 0 else "  Fix increase vs old:        $0.00")
        print()

    # Summary
    total_stored = sum(r["stored_total"] for r in results.values())
    total_old = sum(r["old_calc_total"] for r in results.values())
    total_fixed = sum(r["fixed_calc_total"] for r in results.values())

    print("-" * 80)
    print("SUMMARY")
    print("-" * 80)
    print(f"Total stored cost:        ${total_stored:.6f}")
    print(f"Total OLD calc (cache=$0): ${total_old:.6f}")
    print(f"Total FIXED calc (cache=input/output): ${total_fixed:.6f}")
    print(f"Fix will increase costs by: ${total_fixed - total_old:+.6f} ({(total_fixed - total_old)/total_old*100:.0f}%)")
    print()
    print("The fix ensures cache_read tokens are priced at the input rate")
    print("and cache_write tokens at the output rate when models.dev omits")
    print("these prices, preventing systematic underestimation.")


if __name__ == "__main__":
    verify()
