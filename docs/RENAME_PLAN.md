# Plano de Renomeação: OpenCode → SimplicioCode

> R5 do `docs/EVOLUTION.md`. Renomear o projeto inteiro é destrutivo e impacta 24 packages,
> dezenas de imports e URLs públicas. Para manter cada commit revisável, dividimos em fases.

## Inventário (snapshot 2026-05-28)

```
$ grep -ril "opencode" --include="*.{ts,tsx,js,json,md,toml,yml,yaml,sh,nix}" | wc -l
(centenas de matches — README em ~25 idiomas, package.json, bun.lock, sst.config.ts,
 packages/opencode/**, .opencode/**, sdks/**, scripts de install, etc.)
```

URLs públicas conhecidas (não renomear sem decisão de domínio):

- `opencode.ai` (config schema, docs, instalador)
- `@opencode-ai/*` (pacotes npm publicados)
- `anomalyco/opencode` (URL no `package.json#repository`)

## Fases

### Fase 1 — Display/marketing (sem breaking changes)

Renomear apenas strings visíveis a humanos. Pacotes/imports continuam `opencode`.

Arquivos:

- `README.md` (e variantes `.??.md`): título e linha de pitch.
- `package.json` raiz: campo `description`.
- `STATS.md`, `SECURITY.md`, `CONTRIBUTING.md`: cabeçalhos.

Testes: `bun typecheck` passa; nada quebra.

### Fase 2 — Pacote npm e binário

- `packages/opencode/package.json`: `"name": "opencode"` → `"name": "simpliciocode"` (+ `bin: { simpliciocode: ... }`).
- Manter alias `opencode` apontando para o mesmo binário durante 1 release ciclo.
- Atualizar `package.json` raiz (`scripts.dev`, `postinstall`).
- Atualizar `bunfig.toml`, `turbo.json`.

Testes: `bun run dev`, `bun typecheck`, `bun run lint`.

### Fase 3 — Diretórios

- `packages/opencode/` → `packages/simpliciocode/` (git mv).
- `.opencode/` → `.simpliciocode/` com symlink temporário `.opencode -> .simpliciocode`.
- Atualizar workspaces (`package.json#workspaces`).

Testes: build completo + `dev:desktop`, `dev:web`.

### Fase 4 — Imports e referências internas

- `@opencode-ai/plugin`, `@opencode-ai/sdk`, `@opencode-ai/script` → `@simpliciocode/*`.
- Atualizar `patchedDependencies`, `overrides`, `catalog`.
- Atualizar `sst.config.ts`, `flake.nix`, `infra/`, `nix/`, `script/`.

Testes: `bun turbo typecheck`, smoke do desktop + web + tui.

### Fase 5 — URLs e domínios (decisão pendente)

Adiar até existir um domínio `simplicio.code` ou similar. Por enquanto:

- Manter `opencode.ai` no `$schema` para evitar quebrar o config schema publicado.
- Adicionar redirect/alias quando o domínio Simplicio estiver vivo.

## Política durante a transição

- Cada PR de rename inclui uma entrada datada em `docs/EVOLUTION.md` listando arquivos tocados e fase.
- Não misturar fases em um único commit.
- Sempre rodar `bun turbo typecheck` antes de commitar a fase.
