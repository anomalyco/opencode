/**
 * Composer Island migration tracker
 *
 * Goal
 * - Replace the split composer stack (PromptInput + question/permission/todo docks)
 *   with a single morphing ComposerIsland + app runtime adapter.
 *
 * Current status
 * - [x] Storybook prototype with morphing surfaces exists (`packages/ui/src/components/composer-island.tsx`).
 * - [ ] App still renders the existing production stack (`session-composer-region` + `prompt-input`).
 *
 * Feature parity checklist
 * - [ ] Submit pipeline parity (session/worktree/create, optimistic user message, abort, restore on error).
 * - [x] Runtime adapter API boundary in island (`runtime.submit`, `runtime.abort`, lookup, permission/question handlers).
 * - [x] Shell mode wiring parity (single mode source for tray + editor).
 * - [x] Cursor scroll-into-view behavior in island editor.
 * - [x] Attachment parity in island UI: image + PDF support and file picker wiring.
 * - [x] Drag/drop parity in island UI: attachment drop + `file:` text drop into @mention.
 * - [x] Keyboard parity in island UI: mod+u, ctrl+g, ctrl+n/ctrl+p, popover navigation.
 * - [x] Auto-accept + stop/send state parity in island UI.
 * - [x] Async @mention/slash sourcing parity in island via runtime search hooks.
 * - [ ] Context item parity (comment chips/open behavior is in progress; app comment wiring still pending).
 * - [ ] Question flow parity (island submit/reject hooks + sending locks done; app SDK/cache wiring pending).
 * - [ ] Permission flow parity (island responding lock done; app tool-description wiring pending).
 * - [x] Todo parity in island UI (in-progress pulse + auto-scroll active item).
 */
export { SessionComposerRegion } from "./session-composer-region"
export { createSessionComposerBlocked, createSessionComposerState } from "./session-composer-state"
export type { SessionComposerState } from "./session-composer-state"
