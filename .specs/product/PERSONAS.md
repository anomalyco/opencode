# PERSONAS — Opencode

Personas inferidas automaticamente a partir da stack, dos comandos e da estrutura do repositório.

## Persona 1 — Developer maintainer

**Arquétipo:** Pessoa que altera código, docs e automações do projeto

### Quem é

- **Papel:** developer or repository maintainer
- **Contexto:** trabalha no terminal, editor e CI do repositório
- **Familiaridade com o domínio:** alta em Developer Tools

### Objetivos

- entender rapidamente os comandos reais do projeto
- alterar código sem quebrar validação local
- usar documentação como contexto operacional confiável

### Frustrações

- docs incompletas ou desatualizadas
- falta de comandos claros para validar mudanças

### Métrica que importa

- tempo até primeira mudança validada

## Persona 2 — AI execution agent

**Arquétipo:** Agente que consome o repositório para executar tarefas

### Quem é

- **Papel:** AI agent operating on the repo
- **Contexto:** depende totalmente do contexto escrito no repositório
- **Familiaridade com o domínio:** média em Developer Tools até o projeto detalhar regras próprias

### Objetivos

- localizar áreas importantes do código
- seguir comandos válidos de lint, teste e build
- preservar arquivos do usuário ao aplicar o starter

### Frustrações

- placeholders não resolvidos
- arquivos de contexto em conflito com a implementação real

### Métrica que importa

- percentual de tarefas concluídas sem retrabalho de contexto


## Histórico

| Data | Mudança | Quem |
|---|---|---|
| 2026-05-28 | Personas iniciais geradas automaticamente | wesleysimplicio-team |
