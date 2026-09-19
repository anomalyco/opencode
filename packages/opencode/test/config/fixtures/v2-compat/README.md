# Config Transformation Fixtures

Each directory is an operation, with a flat list of files grouped by case-name prefixes. Add a case without adding another
test body; the runners discover `*-input.*` files in sorted order.

## Operations

| Directory         | Inputs                                               | Expected outputs                                           | Operation                                                                            |
| ----------------- | ---------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `read/`           | `<name>-input.jsonc`                                 | `<name>-output.json`                                       | Parse JSONC, lower supported V2 fields, and decode the V1 schema.                    |
| `update-global/`  | `<name>-input.json` or `.jsonc`, `<name>-patch.json` | `<name>-output.json` or `.jsonc`, `<name>-normalized.json` | Write an isolated global file and invoke the real `Config.updateGlobal` service.     |
| `update-project/` | `<name>-input.json`, `<name>-patch.json`             | `<name>-output.json`, `<name>-normalized.json`             | Write an isolated project `config.json` and invoke the real `Config.update` service. |

Read outputs capture the complete decoded document, including V1 schema defaults, but not environment-dependent runtime
defaults such as the OS username. The read runner also checks that lowering did not mutate its input.

For updates, `<name>-output.*` is the exact text written by the service, including comments, formatting, and the presence or
absence of a final newline. `<name>-normalized.json` records the V1 config returned by `updateGlobal`, or the decoded saved file
for project updates (which return no config). Native V2 data can remain in the saved file even when it is absent or has a
different shape in the in-memory V1 output.

These are checked-in expectations, not output generated during ordinary test runs. Missing expectations fail the test.
Focused tests separately cover invalid inputs, diagnostics, secret redaction, logging, and cross-source behavior.

## Run

From `packages/opencode`:

```sh
bun test test/config/v2-compat.test.ts test/config/config.test.ts --timeout 30000
```

To intentionally regenerate expected outputs:

```sh
UPDATE_CONFIG_FIXTURES=1 bun test test/config/v2-compat.test.ts test/config/config.test.ts --timeout 30000
```

Review every changed `*-output.*` and `*-normalized.json` before accepting it. Do not run a formatter on update outputs; their
exact formatting is part of the snapshot. Inputs are authored by hand and are never rewritten by the fixture runner.
