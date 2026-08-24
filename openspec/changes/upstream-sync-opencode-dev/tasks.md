# Tasks

- [ ] Phase 0 safety: record SHAs, create pre-sync tag, verify working tree clean
- [ ] Add upstream remote and fetch upstream/dev
- [ ] Create sync worktree via bun run sync-upstream:apply
- [ ] Merge upstream/dev into sync worktree
- [ ] Classify conflicts: owned, patched, moved, deleted
- [ ] Resolve conflicts preserving Skein behavior, port to upstream architecture
- [ ] Verify fork:verify passes
- [ ] Run typecheck and behavioral smoke tests
- [ ] Update fork/manifest.json baseline.upstreamRef, syncedAt, forkTag
- [ ] Commit sync changes, push sync branch, open PR to dev
- [ ] Merge PR, tag dev, clean worktree
- [ ] Update FORK_WORKFLOW.md with lessons
