# Fork Facts

moks is a product fork of [OpenCode](https://github.com/anomalyco/opencode).

| Remote | Points at | Role |
|--------|-----------|------|
| `origin` | `artemysone/moks` | where we push |
| `upstream` | `anomalyco/opencode` | where we pull their commits |

## Keep in mind

1. **Not their CI/releases** — Actions, packages, and install scripts still say OpenCode until we change them. Don’t ship moks under their npm/brew names.

2. **Sync early, diverge carefully** — pull `upstream` often at first. Big renames/restructures make later merges painful; batch branding after we know what we’re keeping.

3. **License stays MIT** — keep their copyright notices; add ours for new work. Don’t strip `LICENSE`.

4. **Their secrets/infra aren’t ours** — SST, AWS, console, zen, etc. need our own accounts. Disable or ignore cloud packages until we need them.

5. **Bun, not pnpm** — day-to-day is `bun install` / `bun dev`. Default branch is `dev`, not `main`.

6. **Affiliation** — fine to say “based on OpenCode”; don’t brand as OpenCode or imply official affiliation.

7. **Start small** — huge monorepo. TA harness work starts from `packages/opencode` (CLI/TUI/server). Skip `desktop` / `console` / `web` until needed.

8. **Fork badge** — GitHub shows “Forked from anomalyco/opencode” while this stays a fork. Detach later only if the badge hurts product positioning; `upstream` as a remote still works either way.

9. **Hard choice** — either track upstream and merge often, or accept a hard fork and stop merging. Don’t half-do both after deep product divergence.

## Sync

```bash
git fetch upstream
git merge upstream/dev   # or rebase, if you prefer
git push origin dev
```
