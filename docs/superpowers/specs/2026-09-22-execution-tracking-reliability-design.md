# Execution tracking reliability and header layout

## Purpose and scope

The Execution Map should show a registered run whenever the root controller begins an approved Superpowers plan on this OpenCode installation. The controller must pause plan implementation if registration or reconciliation cannot succeed. The Execution header shortcut must not cover adjacent controls, whether the timeline, side panel, or terminal occupies the right-hand header. Task progress remains explicitly reported and evidence-backed; no plan text or agent activity is parsed into task state.

This is a controller-workflow requirement, not a host-enforced authorization boundary. An agent that ignores its instructions can still call native tools. The plugin's read-only RPC and the UI must not create runs or infer approval.

## Plan-execution preflight

Update the installation's global controller instructions so they apply in every project, including when the companion plugin is missing. Before implementation, implementation-tool use, or implementer dispatch for an approved plan, the root controller must load the reporting instructions, read the approved plan and its SHA-256 hash, and call `execution_read` to discover an active run. A matching active run is reconciled; otherwise the controller calls `execution_report` with `run.start`, the complete stable task graph, required gates, and one final-review task. It waits for the persisted result before beginning work. A plugin capability response, visible badge, local ledger, or attempted tool call is not registration. An active run for a different plan is not silently reused.

The companion's registered reporting skill and transient root-controller reminder give the detailed operations and reinforce the global preflight. Replace their advisory language and current degraded-continuation guidance with the required preflight. The reminder must remain transient, root-only, deduplicated, and compatible with other context hooks; it must not create a run merely because a session exists. Keep existing root ancestry, location ownership, revision checking, and evidence rules.

When reporting tools are missing, registration fails, or storage is unavailable, the controller pauses new implementation and implementation dispatch, states the blocker, and may perform read-only diagnosis. After recovery it reads and reconciles the run before resuming. If a failure occurs with existing workers, it requests a cooperative safe stop and does not claim the children are already paused. A revision conflict requires reconciliation; it is not permission to continue untracked. The approved plan's hash is controller-supplied provenance, not server-certified user approval. Final verification continues to require reported passing gates and final review.

The maintained package documentation describes installation-wide policy and manual update/deployment without restarting the currently running app or server during debugging. Edits to cached external Superpowers skills are not a durable integration point. Since the global policy is outside this repository, document its exact required wording in the package and install it on this machine **after** the reporting companion and header fixes are implemented and verified. The new preflight governs subsequent approved-plan executions; development of the reporting integration itself is not blocked on its not-yet-available tools. Repository tests validate the packaged reporting instructions and hook behavior.

## Header layout

Keep the floating Review control outside panel animations. Measure the inline width of its entire action group, including the Execution badge, optional request action, inter-control gaps, and Review toggle. Reserve at least that width plus the existing alignment gap in the active underlying header: timeline when the side panel is hidden, side-panel actions when it is shown, and terminal headers when terminal content sits under the controls. Measurement updates when labels or attention state change. When measurement is unavailable, preserve at least the original Review-toggle reservation.

The title/content region can shrink and truncate before the action group; controls remain clickable and keyboard reachable. Use logical inline spacing so RTL retains correct positioning. Narrow panel space should use a compact badge presentation before content would overflow, without relying only on viewport width. The tooltip and accessible name retain full status detail. Do not replace measurement with a fixed width that would fail for localized text or the optional request action.

## Verification

- Reproduce the current overlap with component geometry checks at narrow and wide widths for both side-panel states, the terminal, changing status text and request action, and RTL. After the change, assert the action group no longer intersects the adjacent clickable controls and its own click behavior remains correct.
- Add focused reporting-hook and instruction-contract regressions for root/child behavior, no run versus matching run, and failure/recovery guidance. Verify the actual controller preflight against a disposable host or controlled execution scenario: no implementation dispatch before persisted registration, and a visible pause on missing reporting tools.
- Record the app's production benchmark baseline before touching session/timeline code and compare after the layout change; run affected package checks and the repository's canonical `bun run check`.
- Do not restart the running app or server as a debugging or verification step. Installed plugin changes may need a separate deployment step; source verification alone does not establish that the live service has loaded the new package.

## Non-goals

No host-enforced tool interception, automatic run creation from chat prose, fabricated verification, historical backfill, implicit approval detection, or expansion of the read-only UI into an execution controller.
