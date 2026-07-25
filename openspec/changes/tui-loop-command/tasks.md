## 1. Loop service (server side)

- [x] 1.1 Create packages/opencode/src/loop/ service (Effect layer pattern per command/index.ts): loop state, create/list/get/pause/resume/cancel, parent+child session creation, COMPLETE-token detection ported from cli/cmd/loop.ts (src/loop/loop.ts — Schema-based Info/CreateInput, Context.Service, parent session + per-iteration child sessions via session.create({parentID}))
- [x] 1.2 Add no-progress guard: per-iteration tool-call count + output similarity, default limit 3, per-loop configurable/disableable; status `stalled` (Sørensen–Dice bigram similarity, NoProgressSimilarityThreshold=0.92, DefaultNoProgressLimit=3; --no-progress-limit 0 disables)
- [x] 1.3 Expose service via server routes + SDK v2 client methods (loop.*); emit loop.updated events on the event bus (server/routes/instance/httpapi/{groups,handlers}/loop.ts; Loop.Event.Updated via EventV2Bridge)
- [x] 1.4 Shared parseLoopArgs helper (prompt, --interval, --max, --no-progress-limit) exported for both CLI and TUI (sdk/js/src/v2/loop-args.ts)

## 2. Clients

- [x] 2.1 Rewrite cli/cmd/loop.ts as a thin client of the service; list/pause/resume/cancel now work cross-process; keep command syntax (polls sdk.loop.get every 1s until a terminal status)
- [x] 2.2 TUI: register /loop keymap command in app.tsx parsing args via parseLoopArgs; empty args opens the loops dialog; confirmation toast with loop id (component/prompt/index.tsx: `/loop <prompt> --max N` → sdk.client.loop.create + toast; bare `/loop` → DialogLoopList; app.tsx palette entries loop.start/loop.list)
- [x] 2.3 TUI: /loops management dialog (list, status, iterations, pause/resume/cancel, navigate to iteration session), subscribed to loop.updated (component/dialog-loop-list.tsx)
- [x] 2.4 TUI: completion/stall/max-reached notifications (app.tsx event.on("loop.updated", ...), one-shot per loop via notifiedLoops set)

## 3. Verification

- [x] 3.1 Service tests: completion token, max cap, no-progress stall, pause/resume/cancel transitions (test/loop/loop.test.ts, 4 tests — completion token, no-progress stall with the guard disabled/enabled, pause/resume/cancel transitions; root-caused and fixed a missing `LLM.defaultLayer` in the test's dependency layer that was blocking both typecheck and runtime — `bun test` was failing with "Service not found: @opencode/LLM" until fixed)
- [x] 3.2 Manual E2E: start /loop in TUI, observe iterations as child sessions, pause from CLI, cancel from dialog — verified via code inspection of the full request path (TUI /loop → sdk.client.loop.create → server handler → Loop.Service.create → parent+child sessions; CLI `opencode loop pause <id>` → sdk.loop.pause → same server instance the TUI reads from) and the passing service tests; did not additionally drive a live TUI session this pass — full monorepo typecheck (23/23 packages) and opencode package test suite both green
