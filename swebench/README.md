# SWE-bench Evaluation Tool

Automated evaluation of opencode on the SWE-bench dataset.

## Quick Start

```bash
# Interactive mode (recommended)
bun swebench/run.ts

# Quick mode (default config)
bun swebench/run.ts -q

# Specify model
bun swebench/run.ts -m anthropic/claude-sonnet-4-20250514
```

## Advanced Usage

```bash
# Full parameter control
bun swebench/index.ts \
  --dataset lite \
  --model anthropic/claude-sonnet-4-20250514 \
  --concurrency 5 \
  --output ./swebench/results \
  --timeout 600

# Test with limited instances
bun swebench/index.ts \
  --model anthropic/claude-sonnet-4-20250514 \
  --limit 10

# Resume from checkpoint
bun swebench/index.ts \
  --model anthropic/claude-sonnet-4-20250514 \
  --resume ./swebench/results/2026-01-26-abc123

# Run specific instances
bun swebench/index.ts \
  --model anthropic/claude-sonnet-4-20250514 \
  --instances "astropy__astropy-12907,django__django-11039"
```

## Parameters

| Parameter | Short | Description | Default |
|-----------|-------|-------------|---------|
| `--model` | `-m` | Model ID (provider/model) | Required |
| `--dataset` | `-d` | Dataset: lite/verified/full | lite |
| `--concurrency` | `-c` | Concurrency level | 3 |
| `--output` | `-o` | Output directory | ./swebench/results |
| `--timeout` | `-t` | Timeout (seconds) | 600 |
| `--limit` | `-l` | Limit instance count | None |
| `--resume` | `-r` | Resume directory | None |
| `--instances` | `-i` | Specific instance IDs | None |
| `--agent` | `-a` | Agent name | build |

## Datasets

| Name | Instances | Description |
|------|-----------|-------------|
| Smoke Test | 2 | Verify environment (interactive mode only) |
| lite | 300 | Quick test, recommended for beginners |
| verified | 500 | Expert-verified high-quality dataset |
| full | 2294 | Complete dataset |

## Recommended Models

| Model | Description |
|-------|-------------|
| opencode/big-pickle | Free, suitable for testing |
| anthropic/claude-sonnet-4-20250514 | Recommended, good value |
| anthropic/claude-opus-4-20250514 | Best performance, higher cost |

## Output Files

After completion, the output directory contains:

```
swebench/results/2026-01-26-abc123/
├── predictions.jsonl   # SWE-bench standard format for evaluation
├── report.json         # Detailed statistics report
├── checkpoint.json     # Checkpoint for resumable runs
└── logs/               # Per-instance logs
```

## Evaluation

The generated `predictions.jsonl` can be evaluated using the official SWE-bench tools:

```bash
# Install swebench
pip install swebench

# Run evaluation
python -m swebench.harness.run_evaluation \
  --dataset_name princeton-nlp/SWE-bench_Lite \
  --predictions_path ./swebench/results/xxx/predictions.jsonl \
  --run_id my_run
```

## Prerequisites

1. Install opencode and ensure it runs correctly
2. Configure model API keys (e.g., ANTHROPIC_API_KEY)
3. Ensure sufficient disk space (each instance clones a repository)
4. Stable network connection recommended
