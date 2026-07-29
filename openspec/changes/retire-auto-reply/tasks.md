# Tasks: retire-auto-reply

## Phase 1: Audit before deleting

- [ ] 1.1 Confirm the auto-reply service has no production consumer
  - `grep -rn "AutoReply\|autoReply\|shouldAutoReply\|generateReply" packages/ --include=*.ts --include=*.tsx --include=*.go | grep -v node_modules`
  - Expect hits only in: `auto-reply/auto-reply.ts`, `cli/cmd/auto-reply.ts`, `automation/automation-features.ts`, `fork/commands.ts`, and the two test files
  - Validation: no hits under `packages/opencode/src/session/`, `packages/tui/`, `packages/sdk/`

- [ ] 1.2 Audit `automation/` and `pattern-detection.ts` separately — do NOT assume they are dead
  - `grep -rn "AutomationFeatures\|PatternDetection" packages/ --include=*.ts | grep -v node_modules`
  - `pattern-detection` is adjacent to the live sub-agent loop detection from `27397975eb` — verify that feature does not import it
  - Validation: record the result in this task; delete only what has zero production consumers

- [ ] 1.3 Audit `scheduler.ts` and record the finding
  - If it is also inert, note it for a follow-up change — out of scope here
  - Validation: finding recorded; no deletion in this change

## Phase 2: Remove code

- [ ] 2.1 Delete `packages/opencode/src/auto-reply/`
  - Validation: `bun typecheck` in packages/opencode — zero errors

- [ ] 2.2 Delete `packages/opencode/src/cli/cmd/auto-reply.ts` and unregister it
  - `fork/commands.ts`: remove the import (:3) and the command entry (:25)
  - Validation: `bun typecheck` passes; `opencode --help` no longer lists `auto-reply`

- [ ] 2.3 Delete whatever Phase 1 proved inert (`automation/`, `pattern-detection.ts`)
  - Skip any file the audit showed to have a live consumer
  - Validation: `bun typecheck` passes

- [ ] 2.4 Delete the dead tests
  - `packages/opencode/test/automation.test.ts`, `packages/opencode/test/integration/automation-integration.test.ts`
  - Validation: `bun test packages/opencode --timeout 60000` — suite green, no missing-import failures

## Phase 3: Correct the documentation

- [ ] 3.1 Remove the auto-reply sections from `packages/opencode/AUTOMATION_FEATURES.md`
  - Delete :68-84 and the `~/.opencode/auto-reply.json` claim at :173
  - Replace with a pointer to `/loop`
  - Validation: no occurrence of `auto-reply` describing it as available

- [ ] 3.2 Correct `CHANGELOG.md:37` and add a removal entry
  - The new entry states it was never functional and names `/loop` as the replacement
  - Validation: grep confirms no remaining claim that auto-reply works

- [ ] 3.3 Remove the auto-reply capability claim from `skein.json:59-60`
  - Validation: `skein.json` parses; no auto-reply entry

## Phase 4: Verification

- [ ] 4.1 Full build and test
  - Validation: `bun typecheck` zero errors; `bun test packages/opencode --timeout 60000` green

- [ ] 4.2 Confirm no working feature regressed
  - `/loop`, `/loops`, and sub-agent loop detection all still function
  - Validation: `bun test test/loop/ --timeout 30000` green; manual `/loop` smoke test
