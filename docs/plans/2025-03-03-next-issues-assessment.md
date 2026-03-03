# Next Issues Assessment

## #2755 — Copy Mode
**Status: Already works in web app.** Copy buttons exist on all text/code/bash parts. `-webkit-user-select: text` enables click-drag selection. This is primarily a TUI issue (terminal text selection). **No web app changes needed.**

## #7101 — Custom System Prompts
**Status: Already exists.** The config supports:
- `instructions` field for additional instruction files
- `.opencode/agents/` folder for custom agent prompts
- Agent `prompt` field in config
**No changes needed — just needs documentation.**

## #5076 — Better Security Defaults
**Status: Actionable.** Current defaults are all "ask" which is safe, but the issue wants:
- `external_directory: deny` by default (prevent file access outside project)
- Better logging of what tools are doing
**Implementable: change default permission for external_directory.**

## #7602 — Model Fallback/Failover
**Status: Large feature.** Needs:
- New config schema for fallback chains
- Provider selection logic in session processor
- Retry with different model on failure
**Deferred — too large for this session.**
