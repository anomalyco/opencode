---
model: opencode/kimi-k2.5
---

create UPCOMING_CHANGELOG.md

it should have sections

```
# TUI

# Desktop

# Core

# Misc
```

go through each PR merged since the last tag

for each PR spawn a subagent to summarize what the PR was about. focus on user facing changes. if it was entirely internal or code related you can ignore it. also skip docs updates. each subagent should append its summary to UPCOMING_CHANGELOG.md into the appropriate section.
