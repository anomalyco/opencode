# Tasks: auto-mode-btw-command

## Phase 1: Auto mode permission system

- [ ] 1.1 Create `src/auto-mode/rules.ts` with safety rule definitions
  - Define rule categories: safe (file reads, local edits), risky (shell, network), blocked (downloads+exec, exfiltration, prod deploys, mass delete, IAM, force push)
  - Create `evaluateAction(ruleCategory, action, context)` function
  - Validation: unit tests for each rule category with sample actions

- [ ] 1.2 Create `src/auto-mode/service.ts` — AutoMode service
  - Export `AutoMode.Service` with `evaluate(toolCall)` method
  - Integrate with existing `Permission.ask()` flow
  - In auto mode: safe actions skip `Permission.ask()`, risky actions still ask but with auto-approve suggestion
  - Blocked actions are rejected immediately with explanation
  - Validation: `bun typecheck` passes; service can be injected into provider layer

- [ ] 1.3 Replace `--dangerously-skip-permissions` with `--auto` in `cli/cmd/run.ts`
  - Remove `--dangerously-skip-permissions` flag
  - Add `--auto` flag (alias: `-a`)
  - When `--auto` is set, inject `AutoMode` into the permission evaluation chain
  - Auto-approve safe tool calls, prompt for risky ones
  - Validation: `opencode run --auto "test"` runs without permission prompts for safe actions

- [ ] 1.4 Add `defaultMode: "auto"` support in config
  - Update `src/config/config.ts` to support `permissions.defaultMode` with values: `default`, `acceptEdits`, `auto`, `dontAsk`, `bypassPermissions`
  - When `defaultMode: "auto"` is set, start sessions in auto mode
  - Validation: config parses; sessions start in auto mode when configured

## Phase 2: /btw command

- [ ] 2.1 Create `src/cli/cmd/btw.ts` — /btw slash command
  - Parse `/btw [question]` input
  - Create a temporary "side question" session that inherits context from parent
  - No tool access — only text generation from existing context
  - Single response, then discard
  - Does not persist to conversation history
  - Validation: `/btw what was the config file?` returns answer without adding to history

- [ ] 2.2 Integrate /btw into the slash command registry
  - Register in `fork/commands.ts` or equivalent
  - Make available during agent processing (doesn't interrupt main turn)
  - Show in `/` command menu
  - Validation: `/btw` appears in command menu; works mid-turn

- [ ] 2.3 Add overlay display for /btw responses in TUI
  - Show /btw response in a dismissible overlay
  - List earlier /btw exchanges above current answer
  - Navigation: Left arrow to step back through earlier answers
  - Validation: TUI shows overlay; earlier answers accessible

## Phase 3: Model size display fix

- [ ] 3.1 Fix `discoverOpenAICompatibleModels` to capture `size_bytes`
  - Verify `size_bytes` from `/v1/models` is parsed at `provider.ts:1536`
  - Add fallback: when `size_bytes` is null, use `model_mb` from fit report × 1024 × 1024
  - The fit report's `model_mb` is in MB; convert to bytes for `sizeBytes` field
  - Validation: `opencode models` shows size for local models

- [ ] 3.2 Display model size in `opencode models` output
  - When `--verbose` flag is used, show size in GB format (e.g., "7.2 GB")
  - Format: divide bytes by 1024³, show 1 decimal place
  - Validation: `opencode models --verbose` shows size for models with size data

- [ ] 3.3 Add size display in model picker (TUI and CLI run)
  - When selecting a model, show size next to model name for local models
  - Only show for models where `sizeBytes` is defined
  - Validation: model picker shows size for local llama-skein models

## Phase 4: Integration and testing

- [ ] 4.1 End-to-end test: auto mode with safe and risky actions
  - Test file read (should auto-approve)
  - Test shell command (should prompt or evaluate)
  - Test blocked action (should reject immediately)
  - Validation: all test cases pass

- [ ] 4.2 End-to-end test: /btw command
  - Test /btw during agent processing
  - Test /btw doesn't add to history
  - Test /btw has access to conversation context
  - Validation: /btw works as expected

- [ ] 4.3 End-to-end test: model size display
  - Test with llama-skein backend that reports size_bytes
  - Test fallback from fit report model_mb
  - Validation: size displayed correctly in all output formats

- [ ] 4.4 Full build and typecheck
  - `bun typecheck` in packages/opencode — zero errors
  - `bun test packages/opencode --timeout 60000` — all tests green
  - Validation: no regressions in existing features
