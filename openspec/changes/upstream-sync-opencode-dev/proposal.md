# Sync current anomalyco/opencode dev into opencode-skein

## Context
opencode-skein is a permanent downstream fork of anomalyco/opencode. Current baseline is upstream commit 8716c4309a209d50f0b17211e407e317a28cdce3 synced 2026-06-18. Fork is 215 commits ahead, upstream is 1208 commits ahead.

Goal is to bring fork onto current upstream dev without losing Skein capabilities, while preserving fork history and making future syncs easier.

## Requirements
- Preserve fork history; do not rewrite dev
- Integrate upstream via merge into sync worktree, then merge back to dev
- Preserve all Skein capabilities: loop, auto-reply, pattern detection, hooks, scheduler, llama-skein discovery, local provider UI, context sidebar, themed loading
- Update fork/manifest.json baseline atomically with sync
- Verify fork:verify passes and behavioral tests remain green
- Do not discard 215 fork commits
- Keep patch surface minimal

## Non-goals
- Rebase dev history
- Merge fork features upstream
- Major refactor of Skein before sync is stable

## Success criteria
- dev contains upstream dev SHA d041eee55c4b669f583fcbe0eb73e78d53393ae8 or later
- fork/manifest.json baseline updated
- fork:verify passes
- All Skein capabilities verified behaviorally
