# Compiled prompt regression

Source-level tests and a compiled `--version` or health check do not exercise
prompt preparation. This regression runs a supplied native executable through
an authenticated HTTP session, a real file-read tool call, completion and a
second turn retaining the tool result.

From the repository root, with Bun 1.4.2 and dependencies installed:

```sh
OPENCODE_CHANNEL=prod OPENCODE_VERSION=0.0.0-compiled-test \
  MODELS_DEV_API_JSON="$PWD/packages/opencode/test/tool/fixtures/models-api.json" \
  bun run --cwd packages/opencode script/build.ts --single --skip-install
python3 packages/opencode/script/test-compiled-prompt.py \
  packages/opencode/dist/opencode-linux-x64/bin/opencode --expect-bun 1.4.2
```

Use the appropriate native output path on other POSIX platforms. Python 3's
standard library is sufficient. Windows process cleanup is not implemented.
Pass `--expect-bun` explicitly when testing a different embedded runtime.

The runner creates fresh project, HOME, XDG, configuration and database
directories. It starts an ephemeral loopback provider that streams deterministic
responses; it needs no credentials or external model calls. Default plugins,
external skills, model fetching and auto-updates are disabled. A local test
plugin records the actual embedded Bun version and revision. Each HTTP request
has a 60-second timeout, and cleanup terminates only the test process group.

The runner prints and retains its temporary artefact directory, including server
logs, synthetic provider requests and persisted messages, for diagnosis. Use
`--artifacts-dir` to choose an existing parent directory and remove the printed
directory when finished. Do not run Python with `-O`, which disables assertions.

The filesystem service depends on the search node. Importing schema constructors
back through that service creates a runtime cycle: a compiled build can capture
an undefined search node in the filesystem dependency array. Health still passes,
but the first prompt fails in layer resolution before contacting the provider.
Importing the constructors directly from the schema package removes that cycle.

The dedicated CI workflow builds and runs this regression on Linux with Bun
1.4.2 without changing the repository's production runtime pin. It complements
the runtime upgrade in #44946. It does not measure CPU usage or replace
cross-platform testing, real-provider testing or a soak test.
