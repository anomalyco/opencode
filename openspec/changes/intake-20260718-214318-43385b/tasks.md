# Tasks: remove compat dual-writes from change state store

- [ ] Remove compat writes: change NewWithCompat to New in defaults.go and all callers
- [ ] Remove specBase field and all compat write logic from file_store.go
- [ ] Update isInitializedChange to check .skein/changes/<slug>/ instead of openspec/changes/<slug>/.skein/
- [ ] Remove compat reads from HasFlag and FlagMtime
- [ ] Remove legacy file fallback from resolveStatus in openspec/load.go
- [ ] Remove legacy file fallback from resolveStatusWithStore in auditor/auditor.go
- [ ] Update tests to use New instead of NewWithCompat
- [ ] Run Migrate on brick-now repo to copy compat state to primary
- [ ] Clean up compat references in comments and documentation
