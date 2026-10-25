# Quarantined browser tests

Beta pull request and push runs skip the 23 tests tagged `@quarantine` (`--grep-invert @quarantine`). Most failed in every beta run, so they gave no signal and slowed every leg with retries. `dev` runs are unchanged.

To run only the quarantined tests, use `gh workflow run test.yml --ref beta -f quarantine=true`. Their legs report without failing the e2e checks. `nightly-beta.yml` dispatches that run, plus a full beta run, every night. GitHub fires schedules only from the default branch (`dev`), so the nightly run starts once that workflow is on `dev`; until then, dispatch by hand.

**Rule:** fix a quarantined test or delete it within 14 days of quarantine. When a fix lands, remove the tag and its row in the same pull request. Never quarantine a test that fails because of your own change; fix the test or the change.

Quarantined 2026-10-21, so the deadline is **2026-11-04**; the rows first seen red on 2026-10-22 were added that day and are due **2026-11-05**. "First red" is the earliest beta run seen failing; runs before 2026-10-20 05:32 UTC were not collected. "Unowned" means `git blame` points at the history import (#53822).

## App e2e (`packages/app/e2e`)

| Test                                                                                                                                 | Failure signature                                                             | First red          | Owner       |
| ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- | ------------------ | ----------- |
| `regression/timeline-cache.spec.ts` › focuses Find in the selected cached timeline                                                   | `timeline-search-bar input` `toBeFocused()`: inactive                         | ≤ 2026-10-20 05:32 | unowned     |
| `regression/timeline-cache.spec.ts` › disposes the old workspace's shell while destination history is loading                        | `[data-session-title]` text has a `smoke-project/` prefix                     | ≤ 2026-10-20 05:32 | unowned     |
| `regression/mobile-timeline-scroll.spec.ts` › Pixel 7 › returns Home after scrolling the touch target out of view (touchEnd)         | `Part 66.` `not.toBeInViewport()`: still in viewport                          | ≤ 2026-10-20 05:32 | unowned     |
| `regression/mobile-timeline-scroll.spec.ts` › Pixel 7 › returns Home after scrolling the touch target out of view (touchCancel)      | same                                                                          | ≤ 2026-10-20 05:32 | unowned     |
| `regression/mobile-timeline-scroll.spec.ts` › iPhone 13 › returns Home after scrolling the touch target out of view (touchEnd)       | same                                                                          | ≤ 2026-10-20 05:32 | unowned     |
| `regression/mobile-timeline-scroll.spec.ts` › iPhone 13 › returns Home after scrolling the touch target out of view (touchCancel)    | same                                                                          | ≤ 2026-10-20 05:32 | unowned     |
| `regression/new-session.spec.ts` › keeps the user message blue for a managed worktree                                                | `user-message-text` color `rgb(245, 248, 255)`, received `rgb(242, 242, 242)` | ≤ 2026-10-20 11:29 | Luke Parker |
| `regression/new-session.spec.ts` › keeps the user message blue for the main root written with Windows case and separators            | same                                                                          | ≤ 2026-10-20 11:29 | Luke Parker |
| `regression/review.spec.ts` › open file tab browses, searches, and tracks missing files                                              | file search request has an unexpected `directory` field                       | ≤ 2026-10-20 11:29 | unowned     |
| `regression/review.spec.ts` › rereads a file each time an artifact link opens it                                                     | `first draft` never visible in `#review-panel`                                | ≤ 2026-10-20 11:29 | unowned     |
| `regression/session-queue.spec.ts` › keeps finished tools above a pending steer follow-up                                            | pending steer color `rgb(242, 242, 242)`, received `rgb(250, 250, 250)`       | ≤ 2026-10-20 11:29 | unowned     |
| `regression/tabs.spec.ts` › switching between busy sessions keeps the busy indicators and the activity capsule at rest               | `html` keeps `data-test-capsule-missing`                                      | ≤ 2026-10-20 05:32 | Kit Langton |
| `regression/review.spec.ts` › restores review state and the side-panel tab per session                                               | heading `Alpha review state` not found                                        | ≤ 2026-10-22 16:26 | unowned     |
| `regression/session-queue.spec.ts` › reverting to another prompt replaces the file chips of an earlier restore                       | `Rewind to here` resolves to 2 buttons (strict mode)                          | ≤ 2026-10-22 16:26 | unowned     |
| `regression/session-queue.spec.ts` › waiting steers group under one Pending line, each keeping its own actions beside its bubble     | `Move to queue` resolves to 2 buttons (strict mode)                           | ≤ 2026-10-22 16:26 | Kit Langton |
| `regression/session-timeline-accessibility.spec.ts` › shows the agent name in message meta when agents are on                        | meta `Pending·Build·…`, expected `/^Build\s·\s/`                              | ≤ 2026-10-22 16:26 | Kit Langton |
| `regression/timeline-stream.spec.ts` › static projection › renders current protocol notices in CLI order                             | `session-timeline-notice` classes differ                                      | ≤ 2026-10-22 16:26 | unowned     |
| `regression/timeline-stream.spec.ts` › background shortcut › holds a revealed shell from far below just under its stuck group header | predicate expected `0`, received `1` (10 s)                                   | ≤ 2026-10-22 16:26 | unowned     |

## App component tests (`packages/app/component-tests`)

| Test                                                                                        | Failure signature                                                  | First red          | Owner   |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------ | ------- |
| `websearch.spec.ts` › selects and confirms a provider at 360px in ltr light                 | 60 s timeout clicking the `Parallel` option: element is not stable | ≤ 2026-10-20 06:39 | unowned |
| `websearch.spec.ts` › selects and confirms a provider at 360px in ltr dark                  | same                                                               | ≤ 2026-10-20 06:39 | unowned |
| `websearch.spec.ts` › selects and confirms a provider at 360px in rtl light                 | same                                                               | ≤ 2026-10-20 06:39 | unowned |
| `websearch.spec.ts` › selects and confirms a provider at 360px in rtl dark                  | same                                                               | ≤ 2026-10-20 06:39 | unowned |
| `timeline-virtualizer.spec.ts` › reveals ready measured rows after an offset-only reconnect | `data-last-scroll-top` `484`, received `502`                       | ≤ 2026-10-20 06:39 | unowned |
