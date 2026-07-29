# Native Agent Teams

This branch adds persistent concurrent agent teams to the original OpenCode UI.
It does not replace OpenCode with an external terminal coordinator.

## What it provides

- Independent background OpenCode sessions that can execute concurrently.
- Named teammates, including Mark1 and Spencer2.
- A durable SQLite team, member, message, and shared-task model.
- Atomic task claims so two teammates cannot own the same pending task.
- Permission profiles (`lead`, `writer`, and `reviewer`) plus the normal OpenCode
  agent permissions at every filesystem or shell tool boundary.
- Native tools: `team_create`, `team_spawn`, `team_status`, `team_message`, and
  `team_task`.
- Typed `/api/team` endpoints and generated Promise/Effect clients.
- A live right sidebar showing status, model, role, permission, context tokens,
  output TPS, reasoning, current/latest tool, result, errors, tasks, and messages.
- Restart recovery: active members become `interrupted`, their error remains
  visible, and a durable system-to-lead message is created.

## DGX configuration

Use two OpenAI-compatible providers in `~/.config/opencode/opencode.json`:

```json
{
  "provider": {
    "qwen_spark1": {
      "npm": "@ai-sdk/openai-compatible",
      "options": { "baseURL": "http://100.77.131.23:8000/v1", "apiKey": "local" },
      "models": {
        "vincentzed-hf/Qwen3-Coder-Next-NVFP4": {
          "limit": { "context": 262144, "output": 32768 }
        }
      }
    },
    "qwen_spark2": {
      "npm": "@ai-sdk/openai-compatible",
      "options": { "baseURL": "http://100.77.131.23:8001/v1", "apiKey": "local" },
      "models": {
        "vincentzed-hf/Qwen3-Coder-Next-NVFP4": {
          "limit": { "context": 262144, "output": 32768 }
        }
      }
    }
  }
}
```

Mark1 should use `qwen_spark1/...`; Spencer2 should use `qwen_spark2/...`.
Grant Mark1 all five `team_*` permissions. Grant Spencer2 `team_status`,
`team_message`, and `team_task`, while denying `team_create` and `team_spawn`.
Keep Spencer2's `edit`, `write`, `apply_patch`, and non-read-only shell permissions
denied when it is the independent reviewer.

## Use

Open a session with the Mark1 agent and give one mission, for example:

```text
Create a persistent team named ProjectCombo. Spawn Spencer2 with the spencer2
agent, qwen_spark2/vincentzed-hf/Qwen3-Coder-Next-NVFP4, reviewer permission,
and an independent review mission. Create shared tasks, work concurrently, send
named messages, address evidence-backed review findings, and report only after
the task board is complete.
```

Mark1 creates and assigns work. Spencer2 independently reads and reviews through
its own Spark 2 session. Both sessions continue in the background; the sidebar
updates once per second. This is concurrency, not tensor parallelism: each Spark
runs one complete model server and handles its own session.

## Build and safe install on Windows

From the repository root:

```powershell
$env:PATH='C:\Users\markc\.bun\bin;'+$env:PATH
bun install --frozen-lockfile
bun run --cwd packages/opencode build --single --skip-install
powershell -ExecutionPolicy Bypass -File .\script\install-agent-teams.ps1
```

The installer writes `opencode-team.exe` under Local AppData and creates a
separate Desktop launcher. It does not overwrite the normal `opencode` command.

## Verification performed

- Core team/tool tests: 8 passing.
- Protocol, Core, Server, App, CLI, and full workspace type checks.
- Production Web UI build and embedded Windows binary smoke test.
- Both DGX `/v1/models` endpoints healthy.
- Parallel tool-call probes succeeded on ports 8000 and 8001.
- Native Mark1/Spark 1 and Spencer2/Spark 2 sessions both completed a concurrent
  mission through `/api/team`.
- A forced process termination persisted the busy member; restart projected it
  to `interrupted` with a recovery error.
