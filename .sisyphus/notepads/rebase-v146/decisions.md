## Branch 11: feat/github-ref-plugins

- Kept dev's workspace-aware plugin API/types (`experimental_workspace`, adaptor registration, workspace metadata) and layered the branch's skill discovery additions on top.
- Kept the plugin skill integration test in `skill.test.ts`, but ran it through `ToolRegistry.defaultLayer` with a longer per-test timeout because plugin/tool initialization exceeds Bun's default 5s timeout in this workspace.
