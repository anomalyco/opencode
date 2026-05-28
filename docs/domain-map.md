# Domain Map

## Product Context

- App: Opencode
- Main users: Developer maintainer, AI execution agent
- Main business goal: AI-powered development tool

## Core Concepts

| Concept | Meaning | Source of truth |
|---|---|---|
| Session | Conceito recorrente detectado automaticamente no projeto. | .specs/product/DOMAIN.md |
| Workspace | Conceito recorrente detectado automaticamente no projeto. | .specs/product/DOMAIN.md |
| Message | Conceito recorrente detectado automaticamente no projeto. | .specs/product/DOMAIN.md |
| Agent | Conceito recorrente detectado automaticamente no projeto. | .specs/product/DOMAIN.md |

## Critical Rules

| Rule | Expected behavior | Where implemented | How to test |
|---|---|---|---|
| Commands stay documented | Desenvolvimento, validação e evidência precisam estar explícitos | docs/local-setup.md + AGENTS.md | executar os comandos listados |
| Mapping stays current | Mudanças relevantes atualizam docs no mesmo PR | .specs/ + docs/ | revisão de diff |

## Main Entities

| Entity | Description | Storage |
|---|---|---|
| Session | Entidade ou conceito principal identificado no código. | repository structure / docs |
| Workspace | Entidade ou conceito principal identificado no código. | repository structure / docs |
| Message | Entidade ou conceito principal identificado no código. | repository structure / docs |
| Agent | Entidade ou conceito principal identificado no código. | repository structure / docs |
| Project | Entidade ou conceito principal identificado no código. | repository structure / docs |
| Skill | Entidade ou conceito principal identificado no código. | repository structure / docs |

## Important Flows

### Project bootstrap and validation

1. User/system action: apply the starter and inspect the project.
2. Entry point: repository manifest and local scripts.
3. Main modules: package manifest, docs, tests, validation scripts.
4. Output: actionable project map plus runnable commands.
5. Evidence: lint/test output and Playwright report when available.

## Edge Cases

- Commands absent from the manifest: bootstrap falls back to generic runtime defaults.
- Pre-existing docs owned by the host project: automatic mapping preserves them instead of overwriting.
