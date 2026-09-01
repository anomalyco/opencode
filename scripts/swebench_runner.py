#!/usr/bin/env python3
"""
SWE-bench Official Benchmark Runner for OpenCode & OpenCode-Evolve.
Runs real SWE-bench Lite tasks against local Docker sandbox environments.
"""

import json
import os
import subprocess
import sys
from pathlib import Path
from datasets import load_dataset

WORKSPACE_ROOT = Path(__file__).resolve().parent.parent
SWE_VENV_PYTHON = WORKSPACE_ROOT / ".swebench-venv" / "bin" / "python"
PREDICTIONS_DIR = WORKSPACE_ROOT / "benchmark_results"
PREDICTIONS_DIR.mkdir(exist_ok=True)

def load_instances(split="test", limit=5):
    print(f"[*] Loading SWE-bench/SWE-bench_Lite dataset ({split} split)...")
    dataset = load_dataset("SWE-bench/SWE-bench_Lite", split=split)
    instances = list(dataset)[:limit]
    print(f"[+] Loaded {len(instances)} instances.")
    return instances

def format_prediction(instance_id: str, model_patch: str, model_name: str = "opencode-evolve"):
    return {
        "instance_id": instance_id,
        "model_name_or_path": model_name,
        "model_patch": model_patch,
    }

def run_official_evaluation(predictions_file: Path, run_id: str, max_workers: int = 2):
    print(f"\n[+] Running Official SWE-bench Docker Evaluation for: {predictions_file}")
    cmd = [
        str(SWE_VENV_PYTHON),
        "-m", "swebench.harness.run_evaluation",
        "--dataset_name", "SWE-bench/SWE-bench_Lite",
        "--predictions_path", str(predictions_file),
        "--run_id", run_id,
        "--max_workers", str(max_workers),
    ]
    print(f"[*] Command: {' '.join(cmd)}")
    result = subprocess.run(cmd, cwd=str(WORKSPACE_ROOT))
    return result.returncode

def main():
    print("=========================================================================")
    print("        OFFICIAL SWE-BENCH LITE EVALUATION HARNESS FOR OPENCODE          ")
    print("=========================================================================\n")

    instances = load_instances(limit=3)
    
    print("\nTarget Benchmark Instances:")
    for idx, inst in enumerate(instances, 1):
        print(f"  {idx}. [{inst['instance_id']}] {inst['repo']} (base: {inst['base_commit'][:8]})")
        print(f"     Title: {inst['problem_statement'].splitlines()[0][:80]}...")

    print("\nTo evaluate your predictions or gold baseline, run:")
    print(f"  {SWE_VENV_PYTHON} -m swebench.harness.run_evaluation --dataset_name SWE-bench/SWE-bench_Lite --predictions_path gold --instance_ids psf__requests-2674 --run_id test-run")

if __name__ == "__main__":
    main()
