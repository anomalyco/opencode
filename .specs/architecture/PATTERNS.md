# Patterns — Opencode

Padrões iniciais inferidos automaticamente para orientar humanos e agentes até que o projeto refine suas próprias convenções.

## Naming

- Código em inglês, documentação operacional em pt-BR.
- Arquivos preferencialmente em kebab-case.
- Commits em Conventional Commits.

## Estrutura observada

- Diretórios de topo: github, infra, nix, packages, patches, perf, script, sdks, specs
- Stack detectada: undefined
- Package manager: bun

## Comandos principais

- Desenvolvimento: `bun run dev`
- Lint: `bun run lint`
- Testes: `bun test`
- Build: `not detected`

## Regras operacionais

- Ler docs e manifests antes de editar código.
- Validar localmente toda mudança relevante.
- Atualizar CHANGELOG quando a mudança for release-relevant.
- Preservar instruções já existentes do usuário quando o bootstrap detectar arquivos prévios.
