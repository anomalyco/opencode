---
id: 01
title: validar o mapeamento inicial do projeto
status: todo
owner: @wesleysimplicio-team
---

# Task 01 — Validar o mapeamento inicial

## Contexto

O bootstrap gerou automaticamente a primeira versão dos arquivos operacionais de Opencode. Agora o objetivo é revisar o material com foco em Developer Tools e corrigir qualquer comando ou regra que tenha sido inferido de forma incompleta.

## Acceptance Criteria

- [ ] Os comandos em `docs/local-setup.md` funcionam ou estão claramente ajustados.
- [ ] As entidades principais em `.specs/product/DOMAIN.md` representam o projeto real.
- [ ] As integrações e riscos principais estão documentados.

## Test Plan

- Executar `bun run lint`
- Executar `bun test`
- Revisar manualmente `.specs/` e `docs/`
