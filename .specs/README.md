# .specs — Mapa de Navegação

Esta pasta concentra todo o contexto que o agente AI precisa para trabalhar no projeto. Quando algo não está aqui, o agente não vê. Tratar specs como código de primeira classe.

## Ordem de leitura recomendada

Tanto humano novo no time quanto agente devem percorrer nessa ordem:

1. **`product/VISION.md`** — por que o produto existe. Problema, diferencial, métricas.
2. **`product/PERSONAS.md`** — para quem o produto existe. Objetivos e frustrações.
3. **`product/DOMAIN.md`** — vocabulário e entidades de negócio.
4. **`architecture/DESIGN.md`** — diagrama macro, boundaries, stack.
5. **`architecture/PATTERNS.md`** — como escrever código aqui. Naming, estrutura, error handling.
6. **`architecture/ADR-001-example.md`** (e demais ADRs) — decisões arquiteturais e suas razões.
7. **`workflow/WORKFLOW.md`** — branch strategy, PR, deploy, hotfix.
8. **`workflow/CONTRIBUTING.md`** — como adicionar uma feature passo a passo.
9. **`workflow/RELEASE.md`** — versionamento e release.
10. **`sprints/BACKLOG.md`** — lista priorizada do que falta.
11. **`sprints/sprint-XX/SPRINT.md`** — sprint corrente.
12. **`sprints/sprint-XX/NN-*.task.md`** — tasks ativas.

## Estrutura

```
.specs/
├── README.md                # este arquivo
├── product/                 # o porquê e o quê
│   ├── VISION.md
│   ├── DOMAIN.md
│   └── PERSONAS.md
├── architecture/            # o como técnico
│   ├── DESIGN.md
│   ├── PATTERNS.md
│   ├── ADR-template.md
│   └── ADR-001-example.md
├── workflow/                # o processo
│   ├── WORKFLOW.md
│   ├── CONTRIBUTING.md
│   └── RELEASE.md
└── sprints/                 # execução
    ├── BACKLOG.md
    ├── task-template.md
    └── sprint-01/
        ├── SPRINT.md
        └── 01-example.task.md
```

## Convenções

- Markdown puro, com cabeçalho `# Título` claro.
- Diagramas em Mermaid embutido (`mermaid` code block).
- Placeholders entre angle brackets: `Simplicio-code`, `monorepo`, `wesleysimplicio-team`, `developer-tools`.
- Tabelas para glossários e listas comparativas.
- Bullets curtos, frases na voz ativa.
- Idioma: pt-BR para conteúdo, inglês para nomes técnicos (variáveis, comandos).

## Como adicionar nova spec

- Decisão arquitetural -> nova `ADR-NNN-titulo.md` em `architecture/` baseada em `ADR-template.md`.
- Nova feature grande -> criar task baseada em `sprints/task-template.md` dentro de `sprints/sprint-XX/`.
- Novo conceito de domínio -> entrada em `product/DOMAIN.md`.
- Nova rotina de processo -> seção em `workflow/WORKFLOW.md` ou doc novo em `workflow/`.

## Para o agente

Antes de implementar qualquer task:

- Confirmar que leu VISION + DESIGN + PATTERNS + a task atual.
- Procurar ADR relacionada antes de inventar decisão.
- Atualizar DOMAIN se introduzir novo conceito.
- Atualizar BACKLOG ao fechar/abrir item.
