# STORIES.md — behavior spec

> The single source of truth for what this system does and must not do. Grouped by user
> type; every story links to the test that proves it. A story without a passing test is
> incomplete. Maintained per the protocol in CLAUDE.md.

<!-- Functional = can-do (positive test). Security = cannot-do (negative test).
     Link each story to its test path. Keep stories user-observable, not implementation. -->

## User type: <persona>

### Functional (can-do)
- <capability the user has> → `tests/stories/test_<...>.py`

### Security (cannot-do)
- <action the user must NOT be able to perform> → `tests/stories/test_<...>.py`
