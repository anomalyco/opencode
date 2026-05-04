# OpenCode Experiment Runbook

Use this runbook to validate devflow experiments through the local OpenCode fork.
Keep runs isolated from the real `~/.opencode` config unless the task explicitly
asks for a real cutover rehearsal.

## Paths

- OpenCode fork: `/Users/jvanzyl/js/jopen/hojo-opencode`
- Devflow repo: `/Users/jvanzyl/js/ig/devflow2`
- Experiment suite: `/Users/jvanzyl/js/ig/devflow-experiments`
- Native OpenCode binary after local build: `/Users/jvanzyl/js/jopen/hojo-opencode/packages/opencode/dist/opencode-darwin-arm64/bin/opencode`

## Build The Binary

Build a native single-platform binary from the OpenCode package:

```bash
cd /Users/jvanzyl/js/jopen/hojo-opencode/packages/opencode
bun run script/build.ts --single --skip-install
```

Do not use root `bun test`; the root package intentionally refuses it. Use
package-level checks documented in `build-commands.md`.

## Prepare One Fresh Experiment

Create a new project copy and a fresh OpenCode config root:

```bash
ROOT=$(mktemp -d "/tmp/devflow-built-exp-root.XXXXXX")
PARENT=$(mktemp -d "/tmp/devflow-built-exp-project.XXXXXX")
PROJECT="$PARENT/0018-refactor-extract-method"

cp -R "/Users/jvanzyl/js/ig/devflow-experiments/templates/0018-refactor-extract-method" "$PROJECT"
/Users/jvanzyl/js/ig/devflow2/install.sh --target opencode --root "$ROOT"

git init "$PROJECT"
git -C "$PROJECT" add .
git -C "$PROJECT" commit -m "Initial experiment template"

printf 'ROOT=%s\nPROJECT=%s\n' "$ROOT" "$PROJECT"
```

Keep the printed `ROOT` and `PROJECT`; all following commands use them.

## Run The Experiment

Use the experiment prompt after the `---` separator in `EXPERIMENT-PROMPT.md`.
For `0018-refactor-extract-method`, the prompt is:

```text
Refactor the OrderProcessor class per the proposal at docs/work/20260428-refactor-extract-method/02-proposal.md. Existing tests must continue to pass.

/flow --autonomous --start-phase 04 --path refactor
```

Run OpenCode with the isolated config:

```bash
OPENCODE_CONFIG_DIR="$ROOT" /Users/jvanzyl/js/jopen/hojo-opencode/packages/opencode/dist/opencode-darwin-arm64/bin/opencode run --format json --dangerously-skip-permissions --dir "$PROJECT" '<prompt text>'
```

If the run stops early but makes progress, resume with a short continuation
prompt against the same `PROJECT` and `ROOT`. Do not modify generated work by
hand unless the task is to debug the harness itself.

When dispatching `devflow-tester`, include explicit write scope. Valid test
write paths are Java tests under `src/test/java/...` and Python tests under
`tests/...` or `src/test/python/...`. If the experiment starts after phase 00,
also verify `.devflow/phase.json` contains `initiative_path`; otherwise the
criteria coverage gate blocks even valid tester writes.

## Monitor Progress

Do not wait for a long `opencode run` timeout to learn whether an experiment is
stalled. Poll the run while it is active:

```bash
git -C "$PROJECT" status --short --branch
PGPASSWORD=devflow psql -h localhost -p 15433 -U devflow -d devflow -c "SELECT timestamp,sessionid,agenttype,toolname,filepath,command,blocked,blockreason FROM devflow_tool_calls WHERE timestamp > now() - interval '10 minutes' ORDER BY timestamp DESC LIMIT 60;"
PGPASSWORD=devflow psql -h localhost -p 15433 -U devflow -d devflow -c "SELECT sessionid,harness,sessiontype,status,startedat FROM devflow_sessions WHERE startedat > now() - interval '10 minutes' ORDER BY startedat DESC LIMIT 20;"
```

Treat these as stop-and-diagnose signals:

- Any `blocked=true` row.
- No new telemetry for more than a minute while an OpenCode process is alive.
- No git diff after a tester/programmer write task claims progress.
- `mvn test` still reports the original test count after a RED test task.
- A commit made outside OpenCode during an experiment. External commits bypass
  devflow hooks, so `.devflow/commit-order-state.json` may not record
  `testCommitted:true` and later programmer writes can be falsely blocked.
  Exception: a final telemetry-only commit may be needed after all verification,
  because committing `.devflow/workflow-state.json` through OpenCode records one
  more commit event and dirties that same file again.

## Verify The Result

Run these from the experiment project:

```bash
mvn package
bash bin/measure-adherence.sh
git status --short
git log --oneline --decorate -10
```

Expected success shape for `0018-refactor-extract-method`:

- `mvn package` reports `BUILD SUCCESS`.
- The scorer reports `Score: 6/6 (100%)`.
- `git status --short` is clean.
- The history contains separate test/refactor/finalization commits.

## Full Suite Notes

Run one clean single-experiment smoke before attempting the full suite. When the
single smoke is green, use the same isolated-config pattern for additional
templates under `/Users/jvanzyl/js/ig/devflow-experiments/templates/`.

The stock experiment harness in `bin/run-experiment.py` was originally written
for Claude Code. Until it has an explicit OpenCode mode, prefer manual isolated
template runs or update the harness in a separate, reviewed change.

## Evidence To Capture

Record results in `verification-log.md` with:

- OpenCode branch and binary path.
- Devflow commit used for install.
- Experiment template name.
- `ROOT` and `PROJECT` paths if they still exist.
- Final Maven/scorer/status results.
- Any resumed prompts or harness defects discovered.
