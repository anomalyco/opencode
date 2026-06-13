# PR #32087 — Detalhamento de Commits

**Branch:** `dev` → `anomalyco/opencode:dev`
**Author:** @jadsongmatos
**Total commits:** 15 (14 com dados locais)

---

## 1. `cb1605f` — Revise explore agent's role and guidelines

**Data:** 2026-03-30
**Autor:** Jadson G. Matos

Updated the explore agent's role and operational guidelines for file searching.

**Arquivos:**
```
M	packages/opencode/src/agent/prompt/explore.txt
```

---

## 2. `894267c` — feat(core): add PostgreSQL support via OPENCODE_DATABASE_URL

**Data:** 2026-06-03
**Autor:** jadsongmatos

Add dual SQLite/PostgreSQL database backend. When `OPENCODE_DATABASE_URL`
is set to a `postgres://` or `postgresql://` URL, opencode uses PostgreSQL
instead of SQLite. No consumer code changes required.

**Arquivos:**
```
M	bun.lock
A	docker-compose.yml
M	package.json
M	packages/core/package.json
A	packages/core/src/account/sql.pg.ts
M	packages/core/src/account/sql.ts
A	packages/core/src/control-plane/workspace.sql.pg.ts
M	packages/core/src/control-plane/workspace.sql.ts
A	packages/core/src/data-migration.sql.pg.ts
M	packages/core/src/data-migration.sql.ts
M	packages/core/src/database/database.ts
A	packages/core/src/database/dialect.ts
M	packages/core/src/database/migration.ts
A	packages/core/src/database/path.pg.ts
A	packages/core/src/database/pg-bootstrap.ts
A	packages/core/src/database/pg.layer.ts
A	packages/core/src/database/pg.ts
A	packages/core/src/database/schema.pg.ts
A	packages/core/src/database/schema.ts
A	packages/core/src/database/tables.ts
A	packages/core/src/event/sql.pg.ts
M	packages/core/src/event/sql.ts
M	packages/core/src/flag/flag.ts
A	packages/core/src/permission/sql.pg.ts
M	packages/core/src/permission/sql.ts
A	packages/core/src/project/sql.pg.ts
M	packages/core/src/project/sql.ts
A	packages/core/src/session/sql.pg.ts
M	packages/core/src/session/sql.ts
A	packages/core/src/share/sql.pg.ts
```

---

## 3. `427f158` — chore: local changes before rebase

**Data:** 2026-06-05
**Autor:** jadsongmatos

**Arquivos:**
```
M	.dockerignore
M	.gitignore
A	Dockerfile
M	docker-compose.yml
A	entities.json
A	mempalace.yaml
M	packages/core/src/database/database.ts
```

---

## 4. `d5be7db` — feat(core): add seq column and reindex session message tables

**Data:** 2026-06-11
**Autor:** jadsongmatos

**Arquivos:**
```
M	packages/core/src/session/sql.pg.ts
M	packages/core/src/session/sql.ts
```

---

## 5. `60ecee2` — fix(session): handle aborted tool calls without persisted part

**Data:** 2026-06-11
**Autor:** jadsongmatos

**Arquivos:**
```
M	packages/opencode/src/session/processor.ts
```

---

## 6. `b9b34e7` — refactor(core): rewrite project tests with schema-focused units

**Data:** 2026-06-11
**Autor:** jadsongmatos

**Arquivos:**
```
M	packages/core/test/project.test.ts
```

---

## 7. `73349e8` — chore(effect-drizzle-pg): add postinstall patch-drizzle script

**Data:** 2026-06-11
**Autor:** jadsongmatos

**Arquivos:**
```
M	packages/effect-drizzle-pg/package.json
```

---

## 8. `2667f63` — chore: add @libsql/client and pg dependencies

**Data:** 2026-06-11
**Autor:** jadsongmatos

**Arquivos:**
```
M	bun.lock
M	package.json
A	skills-lock.json
```

---

## 9. `6251ced` — chore: update tooling config and lock files

**Data:** 2026-06-11
**Autor:** jadsongmatos

**Arquivos:**
```
M	entities.json
M	mempalace.yaml
A	package-lock.json
M	skills-lock.json
```

---

## 10. `e009f40` — docs: add sbomtest annotation files

**Data:** 2026-06-11
**Autor:** jadsongmatos

Added extensive `.md` annotation files for source code analysis (sbomtest).

**Arquivos (seleção):**
```
A	.agents/skills/ts-export-usage-annotator/SKILL.md
A	.opencode/env.d.ts.md
A	.opencode/plugins/tui-smoke.tsx.md
A	.opencode/tool/github-pr-search.ts.md
A	.opencode/tool/github-triage.ts.md
A	SBOMTEST_CHECKLIST.md
A	github/index.ts.md
A	github/sst-env.d.ts.md
A	infra/app.ts.md
A	infra/console.ts.md
A	infra/enterprise.ts.md
A	infra/lake.ts.md
A	infra/monitoring.ts.md
A	infra/secret.ts.md
A	infra/stage.ts.md
A	infra/stats.ts.md
A	nix/scripts/canonicalize-node-modules.ts.md
A	nix/scripts/normalize-bun-binaries.ts.md
A	packages/app/e2e/regression/prompt-thinking-level.spec.ts.md
A	packages/app/e2e/regression/session-list-path-loading.spec.ts.md
A	packages/app/e2e/regression/session-timeline-collapse-state.spec.ts.md
A	packages/app/e2e/regression/session-timeline-context-resize.spec.ts.md
A	packages/app/e2e/smoke/session-timeline.fixture.ts.md
A	packages/app/e2e/smoke/session-timeline.spec.ts.md
A	packages/app/e2e/utils/errors.ts.md
A	packages/app/e2e/utils/mock-server.ts.md
A	packages/app/e2e/utils/waits.ts.md
A	packages/app/public/oc-theme-preload.js.md
A	packages/app/src/addons/serialize.test.ts.md
A	packages/app/src/addons/serialize.ts.md
```

(+ dezenas de outros arquivos `.md` de anotação — total ~100+ arquivos)

---

## 11. `50ea8b7` — chore: ignore sbomtest dependency directories

**Data:** 2026-06-11
**Autor:** jadsongmatos

**Arquivos:**
```
M	.gitignore
```

---

## 12. `35f34e4` — merge: update to origin/dev

**Data:** 2026-06-12
**Autor:** jadsongmatos

Merge commit sincronizando com o upstream.

---

## 13. `f7d3212` — feat: add PostgreSQL and libSQL client dependencies

**Data:** 2026-06-12
**Autor:** jadsongmatos

Add `@effect/sql-pg`, `pg`, `@libsql/client`, and new `@opencode-ai/effect-drizzle-pg` package.

**Arquivos:**
```
M	bun.lock
M	packages/core/src/database/pg.layer.ts
```

---

## 14. `bbe2701` — Merge branch 'dev' of https://github.com/jadsongmatos/opencode into dev

**Data:** 2026-06-12
**Autor:** jadsongmatos

Merge commit entre remote e local.

---

## 15. `b070756` — Merge branch 'dev' into dev

(sem dados locais — commit presente apenas no remote do fork)
