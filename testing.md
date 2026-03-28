# SWE-bench Lite Testing with OpenCode

This document outlines how to set up and run SWE-bench Lite evaluation using the OpenCode harness.

## Overview

[SWE-bench Lite](https://www.swebench.com/lite.html) is a carefully curated subset of 300 tasks from the full SWE-bench benchmark. It evaluates AI systems on their ability to resolve real GitHub issues by generating patches that pass the repository's test suite.

**Key characteristics:**
- 300 test instances + 23 dev instances
- Covers 11 popular Python repositories (Django, Flask, Requests, Sympy, etc.)
- Each task is a real GitHub issue with a known solution
- Evaluation runs in containerized Docker environments

## Dataset Structure

Each SWE-bench Lite instance contains:

| Field | Description |
|-------|-------------|
| `instance_id` | Unique identifier (e.g., `django__django-11099`) |
| `repo` | Repository name (e.g., `django/django`) |
| `base_commit` | Commit hash representing codebase state before the fix |
| `problem_statement` | The GitHub issue text describing the bug/feature |
| `hints_text` | Optional hints (often empty) |
| `patch` | The ground truth solution (not shown to agent) |
| `test_patch` | Test modifications to verify the fix |
| `FAIL_TO_PASS` | Tests that should fail before and pass after the fix |
| `PASS_TO_PASS` | Regression tests that must continue passing |

### Example Instance

```python
{
  "instance_id": "django__django-11099",
  "repo": "django/django",
  "base_commit": "abc123...",
  "problem_statement": "UsernameValidator allows trailing newlines...",
  "FAIL_TO_PASS": "[\"tests/auth_tests/test_validators.py::TestUsernameValidator\"]",
  "PASS_TO_PASS": "[\"tests/auth_tests/test_validators.py::TestASCIIValidator\", ...]"
}
```

## Prerequisites

### System Requirements

- **OS**: Linux x86_64 recommended (macOS ARM works with `--namespace ''` flag)
- **Storage**: 120GB+ free disk space
- **RAM**: 16GB minimum
- **CPU**: 8+ cores recommended
- **Docker**: Required for containerized evaluation

### Software Installation

```bash
# 1. Install Docker
# Follow: https://docs.docker.com/engine/install/

# 2. Clone and install SWE-bench
git clone git@github.com:princeton-nlp/SWE-bench.git
cd SWE-bench
pip install -e .

# 3. Install Modal (for cloud execution)
pip install modal datasets
modal setup  # Creates account, authenticates CLI

# 4. Verify Modal setup
modal run --detach hello_world.py  # Test deployment
```

### Modal Account Setup

1. Go to [modal.com](https://modal.com) and sign up
2. Run `modal setup` to authenticate
3. Get ~$30 free credits for new accounts
4. Set spending limits in dashboard if needed

### Dataset Access

```python
from datasets import load_dataset

# Load SWE-bench Lite
dataset = load_dataset("princeton-nlp/SWE-bench_Lite")

# Access test split (300 instances)
test_instances = dataset["test"]

# Access dev split (23 instances for development)
dev_instances = dataset["dev"]
```

## Integration Architecture

### Architecture Options

There are three approaches, from simplest to most sophisticated:

---

### Option A: Local Execution (Simplest)

OpenCode runs on your host machine, Docker only for evaluation.

```
┌────────────────────────────────────────────────────────────────────┐
│  GENERATION (Host Machine)                                         │
├────────────────────────────────────────────────────────────────────┤
│  Runner Script                                                      │
│  ├── git clone <repo> && git checkout <base_commit>                │
│  ├── opencode --cwd /tmp/repo --prompt "$problem_statement"        │
│  ├── git diff > patch.diff                                         │
│  └── Write to predictions.jsonl                                    │
└────────────────────────────────────────────────────────────────────┘
                              ▼
┌────────────────────────────────────────────────────────────────────┐
│  EVALUATION (Docker via SWE-bench harness)                         │
│  python -m swebench.harness.run_evaluation --predictions_path ...  │
└────────────────────────────────────────────────────────────────────┘
```

**Pros**: Simple, works today
**Cons**: No isolation, sequential execution, can't parallelize easily

---

### Option B: Docker Sandbox (Isolated)

Each instance runs in its own Docker container with the repo pre-cloned.

```
┌────────────────────────────────────────────────────────────────────┐
│  ORCHESTRATOR (Host)                                               │
├────────────────────────────────────────────────────────────────────┤
│  For each instance:                                                 │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  Docker Container                                             │  │
│  │  ┌────────────────────────────────────────────────────────┐  │  │
│  │  │  - Repo cloned at base_commit                          │  │  │
│  │  │  - OpenCode installed                                  │  │  │
│  │  │  - Run: opencode --prompt "$problem_statement"         │  │  │
│  │  │  - Extract: git diff > /output/patch.diff              │  │  │
│  │  └────────────────────────────────────────────────────────┘  │  │
│  └──────────────────────────────────────────────────────────────┘  │
│  Collect patches → predictions.jsonl                                │
└────────────────────────────────────────────────────────────────────┘
```

**Dockerfile example:**
```dockerfile
FROM python:3.11-slim

# Install dependencies
RUN apt-get update && apt-get install -y git curl
RUN curl -fsSL https://bun.sh/install | bash

# Install OpenCode
COPY . /opencode
WORKDIR /opencode
RUN ~/.bun/bin/bun install

# Entry point
ENTRYPOINT ["/opencode/bin/run-agent.sh"]
```

**Pros**: Isolated, reproducible, parallel locally with docker-compose
**Cons**: Need to manage containers, still limited by local resources

---

### Option C: Modal.com Cloud Execution (Recommended for Scale)

Run agents in parallel on Modal's cloud infrastructure.

```
┌────────────────────────────────────────────────────────────────────┐
│  LOCAL: Runner Script                                              │
├────────────────────────────────────────────────────────────────────┤
│  import modal                                                       │
│  for instance in dataset:                                           │
│      result = run_agent.remote(instance)  # Runs on Modal cloud   │
└────────────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│ Modal Worker │    │ Modal Worker │    │ Modal Worker │
│  Instance 1  │    │  Instance 2  │    │  Instance 3  │
│              │    │              │    │              │
│ - Clone repo │    │ - Clone repo │    │ - Clone repo │
│ - OpenCode   │    │ - OpenCode   │    │ - OpenCode   │
│ - git diff   │    │ - git diff   │    │ - git diff   │
│ - Return     │    │ - Return     │    │ - Return     │
└──────────────┘    └──────────────┘    └──────────────┘
        │                     │                     │
        └─────────────────────┼─────────────────────┘
                              ▼
                    predictions.jsonl
                              │
                              ▼
┌────────────────────────────────────────────────────────────────────┐
│  EVALUATION (also on Modal with --modal flag)                      │
│  python -m swebench.harness.run_evaluation --modal true ...        │
└────────────────────────────────────────────────────────────────────┘
```

**Modal integration code:**
```python
import modal

# Define the image with OpenCode installed
image = modal.Image.debian_slim(python_version="3.11").apt_install(
    "git", "curl"
).run_commands(
    "curl -fsSL https://bun.sh/install | bash",
    "git clone https://github.com/omkaark/opencode /opencode",
    "cd /opencode && ~/.bun/bin/bun install"
)

app = modal.App("swe-bench-opencode")

@app.function(image=image, timeout=1800)  # 30 min timeout
def run_agent(instance: dict) -> dict:
    import subprocess
    import os

    # Clone repo at base_commit
    repo_url = f"https://github.com/{instance['repo']}.git"
    subprocess.run(["git", "clone", repo_url, "/workspace"], check=True)
    os.chdir("/workspace")
    subprocess.run(["git", "checkout", instance["base_commit"]], check=True)

    # Run OpenCode (headless mode)
    subprocess.run([
        "/opencode/bin/opencode", "--headless",
        "--prompt", instance["problem_statement"]
    ], check=True)

    # Extract patch
    result = subprocess.run(["git", "diff", "HEAD"], capture_output=True, text=True)

    return {
        "instance_id": instance["instance_id"],
        "model_name_or_path": "opencode",
        "model_patch": result.stdout
    }

@app.local_entrypoint()
def main():
    from datasets import load_dataset
    import json

    dataset = load_dataset("princeton-nlp/SWE-bench_Lite", split="test")

    # Run all instances in parallel on Modal
    predictions = list(run_agent.map([dict(inst) for inst in dataset]))

    # Write predictions
    with open("predictions.jsonl", "w") as f:
        for pred in predictions:
            f.write(json.dumps(pred) + "\n")
```

**Run with:**
```bash
pip install modal datasets
modal setup  # First time only
modal run runner.py
```

**Pros**:
- Massively parallel (run 100+ instances simultaneously)
- No local resource limits
- SWE-bench evaluation also supports `--modal true`
- Pay only for compute used

**Cons**:
- Requires Modal account
- Network latency for LLM calls
- Need headless mode in OpenCode

---

### Why Docker/Modal?

1. **Isolation**: Each instance gets a clean environment
2. **Reproducibility**: Same container = same results
3. **Parallelization**: Run 100 instances simultaneously
4. **Safety**: Untrusted code runs in sandboxed containers
5. **Scale**: Modal handles infrastructure, you focus on agent

### OpenCode Integration Points

OpenCode needs to:

1. **Receive the task**: Accept `problem_statement` as initial prompt
2. **Work in container**: Operate on the cloned repo at `base_commit`
3. **Generate patch**: Produce a unified diff via `git diff`
4. **Exit cleanly**: Signal completion so runner can extract the patch

## Implementation Plan

### Phase 1: Runner Script

Create a runner script that:

1. Loads SWE-bench Lite dataset from HuggingFace
2. For each instance:
   - Creates a temporary directory
   - Clones the repository at `base_commit`
   - Invokes OpenCode with the `problem_statement`
   - Captures the resulting diff
   - Writes to predictions JSONL

```python
# Pseudo-code structure
import subprocess
from datasets import load_dataset

dataset = load_dataset("princeton-nlp/SWE-bench_Lite", split="test")

predictions = []
for instance in dataset:
    # Setup workspace
    workspace = setup_repo(instance["repo"], instance["base_commit"])

    # Run OpenCode
    result = run_opencode(
        cwd=workspace,
        prompt=instance["problem_statement"]
    )

    # Extract patch
    patch = get_git_diff(workspace)

    predictions.append({
        "instance_id": instance["instance_id"],
        "model_name_or_path": "opencode",
        "model_patch": patch
    })

# Write predictions
write_jsonl("predictions.jsonl", predictions)
```

### Phase 2: OpenCode Invocation

The runner needs to invoke OpenCode, wait for it to complete, then extract the patch.

#### Option A: CLI Mode (Headless) - Recommended
```bash
# Run OpenCode in non-interactive/headless mode
cd $WORKSPACE
opencode --headless --prompt "Fix this issue: $PROBLEM_STATEMENT"

# After OpenCode exits, extract the patch
git diff HEAD > patch.diff
```

**Note**: OpenCode may need a `--headless` or `--non-interactive` flag added. Currently it runs a TUI.

#### Option B: Print Mode (--print)
```bash
# Some CLI tools support --print to output without TUI
opencode --print --prompt "$PROBLEM_STATEMENT" --cwd "$WORKSPACE"
```

#### Option C: Pipe Mode
```bash
# Pipe the prompt via stdin
echo "$PROBLEM_STATEMENT" | opencode --cwd "$WORKSPACE"
```

#### Option D: SDK/Programmatic (TypeScript)
```typescript
import { Session, SessionPrompt } from "opencode"

async function runOnInstance(workspace: string, problemStatement: string) {
  // Create session in the cloned repo directory
  const session = await Session.create({ directory: workspace })

  // Run the agent
  await SessionPrompt.prompt({
    sessionID: session.id,
    parts: [{ type: "text", text: problemStatement }]
  })

  // Extract patch
  const { stdout } = await exec("git diff HEAD", { cwd: workspace })
  return stdout
}
```

#### What Needs to Be Built

OpenCode currently only has interactive TUI mode. For SWE-bench, you need one of:

1. **Headless CLI flag**: `--headless` that runs without TUI, takes prompt, exits when done
2. **SDK entry point**: Expose `Session` and `SessionPrompt` for programmatic use
3. **HTTP server mode**: REST API for remote invocation

### Phase 3: Patch Extraction

After OpenCode completes:

```bash
# Generate unified diff of all changes
cd $WORKSPACE
git diff HEAD > patch.diff

# Or for staged changes
git diff --cached > patch.diff
```

### Phase 4: Evaluation

```bash
# Run SWE-bench evaluation
python -m swebench.harness.run_evaluation \
    --dataset_name princeton-nlp/SWE-bench_Lite \
    --predictions_path predictions.jsonl \
    --max_workers 8 \
    --run_id opencode_eval_v1

# For macOS ARM
python -m swebench.harness.run_evaluation \
    --dataset_name princeton-nlp/SWE-bench_Lite \
    --predictions_path predictions.jsonl \
    --max_workers 8 \
    --namespace '' \
    --run_id opencode_eval_v1
```

### Phase 5: Cloud Evaluation with Modal

SWE-bench has native Modal support for blazing fast evaluation:

```bash
# Install Modal support for SWE-bench
pip install swebench[modal]

# Run evaluation on Modal (parallel across cloud workers)
python -m swebench.harness.run_evaluation \
    --dataset_name princeton-nlp/SWE-bench_Lite \
    --predictions_path predictions.jsonl \
    --parallelism 50 \
    --modal true

# SWE-bench Verified (500 tasks) completes in ~7 minutes on Modal
```

### Full Modal Pipeline

Run both generation AND evaluation on Modal:

```bash
# 1. Generate patches (parallel agent execution)
modal run runner.py  # Outputs predictions.jsonl

# 2. Evaluate patches (parallel test execution)
python -m swebench.harness.run_evaluation \
    --predictions_path predictions.jsonl \
    --modal true \
    --parallelism 50
```

## Prediction Format

Output must be JSONL with one prediction per line:

```jsonl
{"instance_id": "django__django-11099", "model_name_or_path": "opencode", "model_patch": "diff --git a/..."}
{"instance_id": "requests__requests-4356", "model_name_or_path": "opencode", "model_patch": "diff --git a/..."}
```

### Patch Requirements

- Must be valid unified diff format
- Must apply cleanly with `git apply`
- Should only modify source files (not tests)
- Empty patch `""` is valid (indicates no changes)

## Evaluation Outputs

After running evaluation:

```
evaluation_results/
└── opencode_eval_v1/
    ├── results.json           # Summary metrics
    ├── instance_results.jsonl # Per-instance results
    └── run_logs/              # Detailed logs
```

### Metrics

```json
{
  "total_instances": 300,
  "submitted_instances": 300,
  "completed_instances": 298,
  "resolved_instances": 125,
  "resolution_rate": 0.417
}
```

## Development Workflow

### 1. Start with Dev Split

```python
# Use 23 dev instances for development
dev = load_dataset("princeton-nlp/SWE-bench_Lite", split="dev")
```

### 2. Test Single Instance

```bash
# Run on one instance for debugging
python runner.py --instance_id django__django-11099 --debug
```

### 3. Parallel Execution

For full evaluation, use sharding:

```bash
# Run across 10 machines
python runner.py --shard-ct 10 --shard-id 0  # Machine 1
python runner.py --shard-ct 10 --shard-id 1  # Machine 2
# ... etc
```

## Key Considerations

### Prompt Engineering

The `problem_statement` is often verbose. Consider:
- Extracting key information (expected vs actual behavior)
- Adding instructions for the agent
- Setting appropriate token limits

### Timeout Handling

- Set reasonable timeouts per instance (10-30 minutes)
- Handle infinite loops gracefully
- Log partial progress

### Cost Management

- SWE-bench Lite = 300 instances
- Each may require multiple LLM calls
- Consider using smaller models for exploration, larger for final edits

### Caching

With the new subagent context sharing:
- Parent agent explores codebase
- Subagents share cached prefix
- Significant token savings on repeated explorations

## Performance Benchmarks

Reference scores from leaderboards:

| Agent | SWE-bench Lite Score |
|-------|---------------------|
| Claude 3.5 Sonnet (Augment) | 55.0% |
| GPT-4o + SWE-agent | 33.0% |
| Claude 3 Opus + SWE-agent | 26.0% |

## Resources

### SWE-bench
- [SWE-bench GitHub](https://github.com/SWE-bench/SWE-bench)
- [SWE-bench Website](https://www.swebench.com/)
- [SWE-bench Lite Dataset](https://huggingface.co/datasets/princeton-nlp/SWE-bench_Lite)
- [Evaluation Guide](https://www.swebench.com/SWE-bench/guides/evaluation/)
- [Docker Setup Guide](https://www.swebench.com/SWE-bench/guides/docker_setup/)

### Reference Implementations
- [Augment SWE-bench Agent](https://github.com/augmentcode/augment-swebench-agent) - Production agent with ensembling
- [Mini SWE-agent](https://github.com/SWE-agent/mini-swe-agent) - Minimal 100-line agent
- [SWE-ReX](https://github.com/SWE-agent/SWE-ReX) - Sandbox runtime for agents (supports Modal)
- [Open SWE](https://github.com/langchain-ai/open-swe) - LangChain's async coding agent

### Modal
- [Modal.com](https://modal.com) - Cloud compute platform
- [Modal Sandboxes](https://modal.com/blog/sandbox-launch) - Safe code execution
- [Building Coding Agents with Modal](https://modal.com/docs/examples/agent) - Tutorial
- [SWE-bench + Modal Integration](https://modal.com/blog) - Native support

### Docker
- [Docker Installation](https://docs.docker.com/engine/install/)
- [SWE-bench Docker Images](https://github.com/aorwall/SWE-bench-docker) - Optimized images
- [Epoch AI Docker Guide](https://epoch.ai/blog/swebench-docker) - Fast evaluation setup

## What Needs to Be Built in OpenCode

### 1. Headless/Non-Interactive Mode

Currently OpenCode only runs as a TUI. For benchmarking, you need a way to:

```bash
# Ideal interface
opencode run \
  --cwd /tmp/django \
  --prompt "Fix the UsernameValidator to reject trailing newlines..." \
  --max-turns 50 \
  --output patch.diff
```

**Implementation options:**

A. **New CLI command**: Add `opencode run` that skips TUI, runs agent loop, exits
B. **Flag on existing command**: Add `--headless` flag to current `opencode` command
C. **Environment variable**: `OPENCODE_HEADLESS=1 opencode`

### 2. Programmatic Exit

The agent needs to know when to stop:
- After successfully fixing the issue (detected how?)
- After N turns/attempts
- After timeout
- When it explicitly says "I'm done" or calls a `submit` tool

### 3. Patch Extraction

After OpenCode exits, the runner extracts:
```bash
git diff HEAD  # All uncommitted changes
# or
git diff $BASE_COMMIT HEAD  # If OpenCode commits
```

### 4. Structured Output (Optional)

For better integration, OpenCode could output:
```json
{
  "status": "completed",
  "patch": "diff --git a/...",
  "reasoning": "Changed the regex in validators.py to...",
  "files_modified": ["django/contrib/auth/validators.py"]
}
```

## Next Steps

### Phase 1: OpenCode Headless Mode
1. [ ] Add `--headless` flag to skip TUI
2. [ ] Add `--prompt` flag to accept initial prompt
3. [ ] Add `--cwd` flag to set working directory
4. [ ] Implement clean exit when agent completes

### Phase 2: Local Testing
5. [ ] Create runner script (Python)
6. [ ] Test on 1 instance manually
7. [ ] Test on dev split (23 instances)
8. [ ] Verify patch extraction works

### Phase 3: Docker Integration
9. [ ] Create Dockerfile with OpenCode + deps
10. [ ] Test container build and execution
11. [ ] Add volume mounts for output

### Phase 4: Modal Deployment
12. [ ] Create Modal app with OpenCode image
13. [ ] Implement `run_agent.remote()` function
14. [ ] Test with 5 instances in parallel
15. [ ] Run full 300 instances on Modal

### Phase 5: Evaluation
16. [ ] Run SWE-bench evaluation with `--modal true`
17. [ ] Analyze results and failure cases
18. [ ] Iterate on agent behavior / prompting
19. [ ] Compare with leaderboard scores
