---
model: opencode/kimi-k2.5
---

create UPCOMING_CHANGELOG.md

it should have sections

```
## TUI

## Desktop

## Core

## Misc
```

fetch the latest github release for this repository to determine the last release version.

find each PR that was merged since the last release

for each PR spawn a subagent to summarize what the PR was about. focus on user facing changes. if it was entirely internal or code related you can ignore it. also skip docs updates. each subagent should append its summary to UPCOMING_CHANGELOG.md into the appropriate section.
