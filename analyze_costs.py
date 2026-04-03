#!/usr/bin/env python3
"""
Analyze opencode session costs by independently recalculating from token usage
and comparing with the stored costs in the database.

The cost formula from opencode source (session/index.ts):
  cost = (input * price_input + output * price_output + 
          cache_read * price_cache_read + cache_write * price_cache_write +
          reasoning * price_output) / 1_000_000

Prices are in USD per million tokens, from models.dev
"""

import sqlite3
import json
import os
import sys
from pathlib import Path
from collections import defaultdict

DB_PATH = os.path.expanduser("~/.local/share/opencode/opencode.db")

# Known pricing from models.dev (per 1M tokens, USD)
# These are the prices that opencode SHOULD be using
# Source: https://models.dev/api.json (fetched live)
KNOWN_PRICING = {
    # OpenRouter: xiaomi/mimo-v2-pro
    # From models.dev: {"input": 1, "output": 3} — NOTE: NO cache_read in models.dev!
    # But OpenRouter API actually charges: cache_read=$0.20/M
    # This is the BUG: models.dev is missing cache_read price for this model
    "openrouter/xiaomi/mimo-v2-pro": {
        "input": 1.0,       # $1.00/M (from models.dev)
        "output": 3.0,      # $3.00/M (from models.dev)
        "cache_read": 0.2,  # $0.20/M (OpenRouter actual, but MISSING from models.dev!)
        "cache_write": 0.0, # Not charged separately
    },
    # Free models - should be $0
    "opencode/mimo-v2-pro-free": {"input": 0, "output": 0, "cache_read": 0, "cache_write": 0},
    "opencode/mimo-v2-omni-free": {"input": 0, "output": 0, "cache_read": 0, "cache_write": 0},
    "opencode/minimax-m2.1-free": {"input": 0, "output": 0, "cache_read": 0, "cache_write": 0},
    "opencode/qwen3-coder": {"input": 0, "output": 0, "cache_read": 0, "cache_write": 0},
    "opencode/big-pickle": {"input": 0, "output": 0, "cache_read": 0, "cache_write": 0},
    "opencode/qwen3.6-plusfree": {"input": 0, "output": 0, "cache_read": 0, "cache_write": 0},
    "opencode/minimax-m2.5-free": {"input": 0, "output": 0, "cache_read": 0, "cache_write": 0},
    "kilo/x-ai/grok-code-fast-1:optimized:free": {"input": 0, "output": 0, "cache_read": 0, "cache_write": 0},
    "kilo/moonshotai/kimi-k2.5": {"input": 0, "output": 0, "cache_read": 0, "cache_write": 0},
}

# What models.dev actually provides (without cache_read for openrouter/mimo-v2-pro)
# This is what opencode CURRENTLY uses
MODELS_DEV_PRICING = {
    "openrouter/xiaomi/mimo-v2-pro": {
        "input": 1.0,
        "output": 3.0,
        "cache_read": 0.0,  # MISSING from models.dev!
        "cache_write": 0.0,
    },
    # Free models
    "opencode/mimo-v2-pro-free": {"input": 0, "output": 0, "cache_read": 0, "cache_write": 0},
    "opencode/mimo-v2-omni-free": {"input": 0, "output": 0, "cache_read": 0, "cache_write": 0},
    "opencode/minimax-m2.1-free": {"input": 0, "output": 0, "cache_read": 0, "cache_write": 0},
    "opencode/qwen3-coder": {"input": 0, "output": 0, "cache_read": 0, "cache_write": 0},
    "opencode/big-pickle": {"input": 0, "output": 0, "cache_read": 0, "cache_write": 0},
    "opencode/qwen3.6-plusfree": {"input": 0, "output": 0, "cache_read": 0, "cache_write": 0},
    "opencode/minimax-m2.5-free": {"input": 0, "output": 0, "cache_read": 0, "cache_write": 0},
    "kilo/x-ai/grok-code-fast-1:optimized:free": {"input": 0, "output": 0, "cache_read": 0, "cache_write": 0},
    "kilo/moonshotai/kimi-k2.5": {"input": 0, "output": 0, "cache_read": 0, "cache_write": 0},
}


def calc_cost(tokens, prices):
    """Calculate cost from tokens and per-million prices."""
    input_cost = tokens["input"] * prices["input"] / 1_000_000
    output_cost = tokens["output"] * prices["output"] / 1_000_000
    cache_read_cost = tokens["cache_read"] * prices["cache_read"] / 1_000_000
    cache_write_cost = tokens["cache_write"] * prices["cache_write"] / 1_000_000
    # Reasoning tokens charged at output rate
    reasoning_cost = tokens["reasoning"] * prices["output"] / 1_000_000
    
    return input_cost + output_cost + cache_read_cost + cache_write_cost + reasoning_cost


def analyze():
    if not os.path.exists(DB_PATH):
        print(f"Database not found at {DB_PATH}")
        sys.exit(1)
    
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    # Get all assistant messages
    cursor.execute("""
        SELECT 
            m.id,
            m.session_id,
            m.data,
            s.title as session_title,
            s.directory
        FROM message m
        JOIN session s ON m.session_id = s.id
        WHERE json_extract(m.data, '$.role') = 'assistant'
        ORDER BY m.time_created
    """)
    
    rows = cursor.fetchall()
    
    # Aggregation
    total_stored_cost = 0
    total_models_dev_cost = 0  # What opencode calculates using models.dev prices
    total_actual_cost = 0      # What it should actually cost
    messages_analyzed = 0
    messages_with_stored_cost = 0
    
    model_stats = defaultdict(lambda: {
        "count": 0,
        "stored_cost": 0,
        "models_dev_cost": 0,
        "actual_cost": 0,
        "total_tokens": {"input": 0, "output": 0, "reasoning": 0, "cache_read": 0, "cache_write": 0},
        "discrepancies": []
    })
    
    discrepancies = []  # Messages where stored != models_dev calculation
    
    for row in rows:
        data = json.loads(row["data"])
        provider = data.get("providerID", "unknown")
        model = data.get("modelID", "unknown")
        stored_cost = data.get("cost", 0)
        tokens = data.get("tokens", {})
        
        input_tokens = tokens.get("input", 0) if isinstance(tokens, dict) else 0
        output_tokens = tokens.get("output", 0) if isinstance(tokens, dict) else 0
        reasoning_tokens = tokens.get("reasoning", 0) if isinstance(tokens, dict) else 0
        cache_data = tokens.get("cache", {}) if isinstance(tokens, dict) else {}
        cache_read = cache_data.get("read", 0) if isinstance(cache_data, dict) else 0
        cache_write = cache_data.get("write", 0) if isinstance(cache_data, dict) else 0
        
        total_tokens = {
            "input": input_tokens,
            "output": output_tokens,
            "reasoning": reasoning_tokens,
            "cache_read": cache_read,
            "cache_write": cache_write,
        }
        
        model_key = f"{provider}/{model}"
        
        # Get pricing from both sources
        models_dev_prices = MODELS_DEV_PRICING.get(model_key)
        actual_prices = KNOWN_PRICING.get(model_key)
        
        if models_dev_prices is None:
            models_dev_prices = {"input": 0, "output": 0, "cache_read": 0, "cache_write": 0}
        if actual_prices is None:
            actual_prices = {"input": 0, "output": 0, "cache_read": 0, "cache_write": 0}
        
        models_dev_calc = calc_cost(total_tokens, models_dev_prices)
        actual_calc = calc_cost(total_tokens, actual_prices)
        
        # Accumulate
        total_stored_cost += stored_cost
        total_models_dev_cost += models_dev_calc
        total_actual_cost += actual_calc
        if stored_cost > 0:
            messages_with_stored_cost += 1
        messages_analyzed += 1
            
        ms = model_stats[model_key]
        ms["count"] += 1
        ms["stored_cost"] += stored_cost
        ms["models_dev_cost"] += models_dev_calc
        ms["actual_cost"] += actual_calc
        ms["total_tokens"]["input"] += input_tokens
        ms["total_tokens"]["output"] += output_tokens
        ms["total_tokens"]["reasoning"] += reasoning_tokens
        ms["total_tokens"]["cache_read"] += cache_read
        ms["total_tokens"]["cache_write"] += cache_write
        
        # Check for discrepancy between stored and models.dev calculation
        if abs(stored_cost - models_dev_calc) > 0.0001:
            discrepancy = {
                "message_id": row["id"],
                "session": row["session_title"] or row["session_id"][:8],
                "model": model_key,
                "stored": stored_cost,
                "models_dev_calc": models_dev_calc,
                "actual_calc": actual_calc,
                "diff_from_stored": stored_cost - models_dev_calc,
                "tokens": total_tokens,
            }
            discrepancies.append(discrepancy)
            ms["discrepancies"].append(discrepancy)
    
    conn.close()
    
    # Print results
    print("=" * 80)
    print("OPENCODE COST ANALYSIS")
    print("=" * 80)
    print()
    
    print(f"Total assistant messages: {len(rows)}")
    print(f"Messages with stored cost > 0: {messages_with_stored_cost}")
    print(f"Messages analyzed (known pricing): {messages_analyzed}")
    print()
    
    print("-" * 80)
    print("AGGREGATE COSTS")
    print("-" * 80)
    print(f"Total stored cost (database):      ${total_stored_cost:.6f}")
    print(f"Total models.dev calculation:      ${total_models_dev_cost:.6f}")
    print(f"Total actual cost (real pricing):   ${total_actual_cost:.6f}")
    print()
    stored_vs_modelsdev = total_stored_cost - total_models_dev_cost
    modelsdev_vs_actual = total_models_dev_cost - total_actual_cost
    if abs(stored_vs_modelsdev) > 0.0001:
        print(f"Stored vs models.dev:  ${stored_vs_modelsdev:+.6f} ({'stored higher' if stored_vs_modelsdev > 0 else 'models.dev higher'})")
    else:
        print(f"Stored vs models.dev:  $0.000000 (MATCH — stored costs use models.dev prices correctly)")
    print(f"models.dev vs actual:  ${modelsdev_vs_actual:+.6f} (UNDERCHARGE due to missing cache_read pricing)" if modelsdev_vs_actual < 0 else f"models.dev vs actual:  ${modelsdev_vs_actual:+.6f}")
    print()
    print(f"  => You are being undercharged by ${abs(modelsdev_vs_actual):.6f} because models.dev")
    print(f"     doesn't include cache_read pricing for openrouter/xiaomi/mimo-v2-pro")
    print()
    
    print("-" * 80)
    print("COSTS BY MODEL")
    print("-" * 80)
    for model_key, stats in sorted(model_stats.items(), key=lambda x: x[1]["actual_cost"], reverse=True):
        print(f"\n{model_key}")
        print(f"  Messages: {stats['count']}")
        t = stats["total_tokens"]
        print(f"  Tokens: input={t['input']:,} output={t['output']:,} reasoning={t['reasoning']:,} "
              f"cache_read={t['cache_read']:,} cache_write={t['cache_write']:,}")
        print(f"  Stored cost:       ${stats['stored_cost']:.6f}")
        print(f"  models.dev calc:   ${stats['models_dev_cost']:.6f}")
        print(f"  Actual cost:       ${stats['actual_cost']:.6f}")
        gap = stats["models_dev_cost"] - stats["actual_cost"]
        if abs(gap) > 0.0001:
            print(f"  ** GAP: ${gap:+.6f} (models.dev undercharges by missing cache_read) **")
        elif stats["stored_cost"] > 0:
            print(f"  (stored matches models.dev — both use incomplete pricing)")
    
    print()
    print("-" * 80)
    print("DISCREPANCY DETAILS (first 20)")
    print("-" * 80)
    if not discrepancies:
        print("No discrepancies between stored and models.dev calculation!")
        print("Stored costs in the database match what models.dev prices would produce.")
    else:
        for d in discrepancies[:20]:
            print(f"\n  Model: {d['model']}")
            print(f"  Session: {d['session']}")
            print(f"  Stored:        ${d['stored']:.6f}")
            print(f"  models.dev:    ${d['models_dev_calc']:.6f}")
            print(f"  Actual cost:   ${d['actual_calc']:.6f}")
            print(f"  Diff (stored - models.dev): ${d['diff_from_stored']:+.6f}")
            t = d['tokens']
            print(f"  Tokens: input={t['input']:,} output={t['output']:,} reasoning={t['reasoning']:,} "
                  f"cache_read={t['cache_read']:,}")
    
    if len(discrepancies) > 20:
        print(f"\n  ... and {len(discrepancies) - 20} more discrepancies")
    
    print()
    print("=" * 80)
    print("ANALYSIS COMPLETE")
    print("=" * 80)


if __name__ == "__main__":
    analyze()
