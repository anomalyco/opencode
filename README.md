## Install

- `bun` instalado
- dependencias instaladas com `bun install`

## Comandos que eu devo usar

```bash
bun install
bun run dev
bun run dev:desktop
bun run dev:web
bun run dev:console
bun run lint
bun run typecheck
```

## Observacoes

- Nao rodar `test` na raiz do repositorio.
- Para checagem de tipos, usar `bun run typecheck`.
- Para publicar release pela raiz:

```bash
bun run release
bun run release:skip-build
```

## Estrutura rapida

- `packages/opencode`: CLI principal
- `packages/app`: app web
- `packages/desktop-electron`: app desktop
- `packages/console/app`: interface de console
