# Spike — P0 compatibility investigations

Minimal plugin + drive scripts that answer the P0 questions from `docs/phase0-findings.md`
against the isolated fork-built runtime and the mock LLM.

## Sandbox layout (created by `scripts/dev-opencode.sh`)

```
$SANDBOX_ROOT/
  config/opencode/     # OPENCODE_CONFIG_DIR — opencode.json lives here
  data/                # XDG_DATA_HOME (session DB, logs)
  cache/ state/ home/  # remaining XDG roots + HOME
  project/             # the test project (plugin dir + rollover.json live here)
```

## Running

```sh
scripts/dev-opencode.sh /path/to/sandbox/project --version
scripts/dev-opencode.sh /path/to/sandbox/project run "hello"
scripts/cleanup.sh /path/to/sandbox
```
