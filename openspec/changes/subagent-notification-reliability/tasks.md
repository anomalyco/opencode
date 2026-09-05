# Tasks: subagent notification reliability

## Slice 1: Reproduce and root-cause

- [ ] 1.1 Instrument the background-subagent path: log placement, child session creation, child
      completion, and synthetic-message injection as distinct timestamped events.
  - File: `packages/opencode/src/tool/task.ts`
  - Validation: log lines visible for a background subagent run
- [ ] 1.2 Reproduce the "parent idles after backgrounding" symptom deliberately: place a
      background subagent on a target expected to take materially longer than the parent's own
      remaining work, and observe whether the parent's turn resumes on completion or only on the
      next unrelated input.
  - Validation: recorded reproduction (pass/fail against expected wake-up)
- [ ] 1.3 Classify the root cause against the four hypotheses in proposal.md §1 and record the
      finding in `.specsync/` or a `design.md` note before proceeding to Slice 2.
  - File: `openspec/changes/subagent-notification-reliability/design.md`
  - Validation: n/a — investigation artifact

## Slice 2: Fix (scope depends on Slice 1 finding)

- [ ] 2.1 If injection never fires: fix the completion→synthetic-message wiring at its actual
      break point (exact file TBD by 1.3).
  - Validation: reproduction from 1.2 now shows the parent resuming on completion
- [ ] 2.2 If injection fires but does not wake an idle turn: ensure a background-subagent result
      can resume/schedule the parent's turn rather than only being visible on the next unrelated
      prompt.
  - File: `packages/opencode/src/session/processor.ts`
  - Validation: reproduction from 1.2 shows resumption without any further user input
- [ ] 2.3 If the subagent itself errored/hung: route this to `fleet-instance-presence` Phase 6
      instead of fixing here; close this task with a cross-reference, not a code change.
  - Validation: n/a — coordination task

## Slice 3: Bounded-wait notification

- [ ] 3.1 Add a wall-clock ceiling on background-subagent completion; on timeout, notify the
      parent explicitly ("subagent X has not completed after N minutes") rather than leaving it
      to infer stall from silence.
  - File: `packages/opencode/src/tool/task.ts`
  - Validation: unit test — a subagent mock that never completes triggers the timeout
    notification within the configured window
- [ ] 3.2 On subagent error, ensure the parent is notified of failure (not silence).
  - File: `packages/opencode/src/tool/task.ts`
  - Validation: unit test — a subagent mock that errors produces a failure notification

## Slice 4: Verification

- [ ] 4.1 `bun run typecheck` and `bun test test/tool/ test/session/` green.
  - Validation: `bun run typecheck && bun test test/tool/ test/session/`
- [ ] 4.2 Live check on a real fleet run: background subagent placed on a genuinely slow target,
      parent confirmed to keep making progress and then react to the injected result without any
      further human input. Also close the still-open `subagent-background-default` task 6 with
      this evidence.
