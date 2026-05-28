---
name: nome-da-skill
description: descreva em uma frase quando o agente deve ativar essa skill
---

# Skill: `nome-da-skill`

Template base para criar uma nova skill. Copie este arquivo para `.skills/<sua-skill>/SKILL.md` e edite cada section.

> **Como usar este template:** substitua o frontmatter, preencha as 4 sections obrigatórias (Trigger, Steps, Padrões, Definition of Done) e remova este bloco de instruções. Veja `.skills/README.md` para boas práticas.

---

## Trigger

> Liste **quando** essa skill deve ativar. Pense em palavras-chave que apareceriam no pedido do usuário ou na descrição da task. O agente faz match implícito pelo `description` do frontmatter, mas listar triggers explícitos aqui ajuda quando alguém revisa o catálogo de skills.

- Quando o usuário pedir "<exemplo de pedido típico>".
- Ao executar a tarefa "<nome da tarefa>".
- Sempre que tocar arquivos sob `<path/relevante>`.

---

## Steps

> Sequência **numerada** de passos que o agente segue. Cada passo deve ser um verbo no imperativo ("crie", "rode", "valide"). Evite passos compostos — se o passo tem dois verbos, divida em dois passos.

1. Identifique o contexto: leia o arquivo X / verifique a configuração Y.
2. Execute a ação principal: descreva exatamente o que mudar ou criar.
3. Valide o resultado: rode o comando de verificação adequado.
4. Documente o que foi feito: atualize changelog / comentário no PR / etc.

---

## Padrões

> Convenções específicas que o agente precisa respeitar. Naming, estrutura, tom, dependências evitadas. Use bullets curtos. Se virar lista grande (>10 itens), provavelmente esse conteúdo merece estar em `.specs/architecture/PATTERNS.md` em vez de uma skill.

- Naming: `<convenção>` (ex.: `kebab-case` para arquivos).
- Estrutura: `<padrão de pastas>` (ex.: `tests/e2e/<feature>.spec.ts`).
- Evite: `<antipadrão comum>` (ex.: `sleep` arbitrário, mock pra fazer passar).
- Prefira: `<padrão alternativo>` (ex.: `await expect(...).toBeVisible()`).

---

## Definition of Done

> Checklist **verificável** que o agente marca antes de declarar a tarefa concluída. Cada item precisa ser objetivamente checável (true/false), não subjetivo.

- [ ] Comando de validação roda sem erro localmente.
- [ ] Evidência gerada (screenshot / log / artifact) salva no caminho esperado.
- [ ] Documentação relacionada atualizada (se aplicável).
- [ ] Convenção de naming aplicada.
- [ ] Sem warnings novos no output do build.

---

## Exemplo (opcional)

> Inclua um exemplo concreto se a skill envolve gerar código ou comando. Use code block com tag de linguagem.

```bash
# Exemplo de comando que essa skill executaria
echo "substituir por exemplo real"
```

---

## Notas

> Espaço livre para gotchas, links pra docs externas, ADRs relacionadas, ou histórico breve. Mantenha curto.

- Link pra ADR relacionada: `.specs/architecture/ADR-XXX.md`.
- Doc externa: `<url>`.
- Última revisão: `<YYYY-MM-DD>`.
