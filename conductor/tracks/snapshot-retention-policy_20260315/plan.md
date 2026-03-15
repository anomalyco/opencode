# Track: Snapshot retention policy (200GB leak fix)

Root cause of GHSA-xv3r-6x54-766h: `~/.local/share/opencode/snapshot/` accumulates
one bare git repo per session with no TTL or size cap. 22 snapshots = 408MB on one
machine; scales to 200GB+ on aarch64 Macs with busy sessions or large repos.

Also: one SQLite `.db` file per git branch, never pruned.

## Observed state (jnorthrup machine)
- `~/.local/share/opencode/opencode.db` — 259MB
- `~/.local/share/opencode/snapshot/` — 22 dirs, 408MB total, largest 183MB
- Total: 1.6GB on a single machine after normal use

## Scope
- `packages/opencode/src/` — find snapshot write path, add retention policy
- Default: keep last 5 snapshots, delete oldest on creation of new one
- Configurable via opencode.json: `{ "snapshot": { "max_count": 5 } }`
- Target branch: advisory-fix-1 on anomalyco/opencode-ghsa-xv3r-6x54-766h

## Status
- [ ] Locate snapshot creation code in CLI source
- [ ] Add retention enforcement on snapshot write
- [ ] Add db file pruning for stale branch databases
- [ ] Push to advisory-fix-1
- [ ] Update GHSA-xv3r-6x54-766h advisory with root cause detail
