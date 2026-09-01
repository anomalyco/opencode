#!/usr/bin/env python3
"""
Automated SWE-bench Batch Runner & Docker Evaluation Pipeline for OpenCode.
Executes the standard 2-step benchmark process used by SWE-agent & OpenHands:
  Step 1: Automated Agent Inference (Runs OpenCode CLI on target instance)
  Step 2: Official Docker Evaluation Harness (Scores patch with swebench)
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path
from datasets import load_dataset

# Ensure all output flushes immediately to logs
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(line_buffering=True)
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(line_buffering=True)

WORKSPACE_ROOT = Path(__file__).resolve().parent.parent
SWE_VENV_PYTHON = WORKSPACE_ROOT / ".swebench-venv" / "bin" / "python"
BENCHMARK_DIR = WORKSPACE_ROOT / "benchmark_runs"
PREDICTIONS_FILE = BENCHMARK_DIR / "predictions.jsonl"
BENCHMARK_DIR.mkdir(exist_ok=True)

def setup_repo(instance: dict, run_dir: Path) -> Path:
    """Clones repo and checks out the SWE-bench base commit."""
    repo_name = instance["repo"]
    base_commit = instance["base_commit"]
    repo_dir = run_dir / instance["instance_id"]
    
    if repo_dir.exists():
        shutil.rmtree(repo_dir)
    repo_dir.mkdir(parents=True, exist_ok=True)

    print(f"\n[*] [Step 1/3] Cloning https://github.com/{repo_name} into {repo_dir}...")
    subprocess.run(
        ["git", "clone", f"https://github.com/{repo_name}.git", str(repo_dir)],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    print(f"[*] [Step 2/3] Checking out base commit: {base_commit[:8]}...")
    subprocess.run(
        ["git", "checkout", base_commit],
        cwd=str(repo_dir),
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    return repo_dir

def run_opencode_agent(repo_dir: Path, problem_statement: str, model: str = None, pure: bool = False, vanilla: bool = False, binary: str = None, timeout: int = 1200) -> str:
    """Executes OpenCode CLI on the repository with the problem statement and extracts git diff."""
    if binary:
        cmd = [binary, "run", "--auto"]
    elif vanilla:
        print("[*] Using Official Upstream Vanilla OpenCode (`bunx opencode-ai`)...")
        cmd = ["bunx", "opencode-ai", "run", "--auto"]
    else:
        print("[*] Using OpenCode-Evolve Binary (`~/.local/bin/opencode`)...")
        cmd = ["opencode", "run", "--auto"]

    cmd.extend(["--dir", str(repo_dir.resolve())])
    if pure:
        cmd.append("--pure")
    if model:
        cmd.extend(["-m", model])

    task_prompt = (
        "You are an autonomous software engineering agent tasked with resolving an issue in this repository.\n\n"
        "INSTRUCTIONS:\n"
        "1. Inspect the codebase and locate the root cause of the bug.\n"
        "2. You MUST directly EDIT and MODIFY the relevant source files in the repository to implement the fix.\n"
        "3. Do NOT just explain or describe the solution — write the changes into the files so `git diff` contains the complete working patch.\n\n"
        f"ISSUE TO RESOLVE:\n{problem_statement}"
    )
    cmd.append(task_prompt)

    print(f"[*] [Step 3/3] Executing agent command: {' '.join(cmd[:4])}...")
    start_time = time.time()
    timeout_val = timeout if timeout and timeout > 0 else None
    try:
        proc = subprocess.run(
            cmd,
            cwd=str(repo_dir),
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            timeout=timeout_val,
        )
        elapsed = time.time() - start_time
        print(f"[+] OpenCode finished in {elapsed:.1f}s (Exit code: {proc.returncode})")
        if proc.returncode != 0:
            if proc.stderr:
                print(f"[-] OpenCode Stderr:\n{proc.stderr.strip()[:500]}")
            if proc.stdout:
                print(f"[*] OpenCode Stdout:\n{proc.stdout.strip()[:500]}")
    except subprocess.TimeoutExpired:
        print(f"[-] OpenCode execution timed out ({timeout // 60}m limit).")

    # Extract git diff patch
    diff_proc = subprocess.run(
        ["git", "diff"],
        cwd=str(repo_dir),
        capture_output=True,
        text=True,
        check=True,
    )
    patch = diff_proc.stdout
    print(f"[+] Generated Git Patch Size: {len(patch)} bytes ({len(patch.splitlines())} lines)")
    return patch

import concurrent.futures
import threading

def process_single_instance(inst: dict, args, lock: threading.Lock, output_pred_file: Path) -> dict:
    """Processes a single SWE-bench instance and writes prediction atomically."""
    instance_id = inst["instance_id"]
    with lock:
        print(f"\n=========================================================================")
        print(f"[*] Starting Instance: {instance_id} ({inst['repo']})")
        print(f"    Issue: {inst['problem_statement'].splitlines()[0][:80]}")
        print("=========================================================================")

    repo_dir = setup_repo(inst, BENCHMARK_DIR / "workspaces")
    patch = run_opencode_agent(
        repo_dir,
        inst["problem_statement"],
        model=args.model,
        pure=args.pure,
        vanilla=args.vanilla,
        binary=args.binary,
        timeout=args.timeout,
    )

    model_tag = "opencode-vanilla-baseline" if args.vanilla else "opencode-evolve"
    pred = {
        "instance_id": instance_id,
        "model_name_or_path": model_tag,
        "model_patch": patch,
    }

    with lock:
        with open(output_pred_file, "a") as f:
            f.write(json.dumps(pred) + "\n")
        print(f"[+] [Completed {instance_id}] Patch saved ({len(patch)} bytes) -> {output_pred_file.name}")

    return pred

def main():
    parser = argparse.ArgumentParser(description="SWE-bench Automated Benchmark Pipeline for OpenCode")
    parser.add_argument("--instances", nargs="+", default=["pallets__flask-4045"], help="Instance IDs to run or 'all' (e.g. pallets__flask-4045, all)")
    parser.add_argument("--limit", type=int, default=None, help="Limit number of instances when running all")
    parser.add_argument("--split", default="test", help="SWE-bench dataset split")
    parser.add_argument("--model", default=None, help="Specific model to pass to opencode -m")
    parser.add_argument("--timeout", type=int, default=0, help="Per-task timeout in seconds (default: 0 for unlimited runtime)")
    parser.add_argument("--workers", type=int, default=2, help="Parallel agent workers for patch generation (default: 2)")
    parser.add_argument("--max-eval-workers", type=int, default=12, help="Parallel Docker evaluation workers (default: 12)")
    parser.add_argument("--cache-level", default="env", choices=["none", "env", "instance"], help="Docker evaluation cache level (default: env)")
    parser.add_argument("--vanilla", action="store_true", help="Run the official upstream Vanilla OpenCode (bunx opencode-ai)")
    parser.add_argument("--binary", default=None, help="Custom binary path for OpenCode")
    parser.add_argument("--pure", action="store_true", help="Run with --pure flag")
    parser.add_argument("--run-id", default="opencode-eval", help="Evaluation run ID")
    parser.add_argument("--skip-eval", action="store_true", help="Skip Docker evaluation step")
    args = parser.parse_args()

    print("=========================================================================")
    print("      AUTOMATED SWE-BENCH BENCHMARK PIPELINE FOR OPENCODE-EVOLVE         ")
    print("=========================================================================")

    print(f"[*] Loading SWE-bench/SWE-bench_Lite dataset ({args.split} split)...")
    dataset = load_dataset("SWE-bench/SWE-bench_Lite", split=args.split)

    if "all" in args.instances:
        target_instances = list(dataset)
        if args.limit:
            target_instances = target_instances[:args.limit]
    else:
        instance_map = {item["instance_id"]: item for item in dataset}
        target_instances = [instance_map[id] for id in args.instances if id in instance_map]

    print(f"[+] Running {len(target_instances)} benchmark instance(s) with {args.workers} parallel worker(s).")
    output_pred_file = BENCHMARK_DIR / f"{args.run_id}_predictions.jsonl"
    if output_pred_file.exists():
        output_pred_file.unlink()

    file_lock = threading.Lock()
    predictions = []

    if args.workers <= 1 or len(target_instances) <= 1:
        for inst in target_instances:
            pred = process_single_instance(inst, args, file_lock, output_pred_file)
            predictions.append(pred)
    else:
        with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as executor:
            futures = [
                executor.submit(process_single_instance, inst, args, file_lock, output_pred_file)
                for inst in target_instances
            ]
            for future in concurrent.futures.as_completed(futures):
                try:
                    pred = future.result()
                    predictions.append(pred)
                except Exception as e:
                    print(f"[-] Worker error: {e}")

    if not predictions:
        print("[-] No predictions generated. Exiting.")
        return

    print(f"\n[+] Saved {len(predictions)} total predictions to: {output_pred_file}")

    if args.skip_eval:
        print("[*] Skipping Docker evaluation (--skip-eval specified).")
        return

    # Run official Docker evaluation
    print("\n=========================================================================")
    print(f"   STARTING OFFICIAL SWE-BENCH DOCKER EVALUATION ({args.max_eval_workers} WORKERS)    ")
    print("=========================================================================")
    eval_cmd = [
        str(SWE_VENV_PYTHON),
        "-m", "swebench.harness.run_evaluation",
        "--dataset_name", "SWE-bench/SWE-bench_Lite",
        "--predictions_path", str(output_pred_file),
        "--run_id", args.run_id,
        "--max_workers", str(args.max_eval_workers),
    ]
    subprocess.run(eval_cmd, cwd=str(WORKSPACE_ROOT))

if __name__ == "__main__":
    main()
