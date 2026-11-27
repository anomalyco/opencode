---
title: Políticas
description: Controle quais recursos configurados o OpenCode pode usar.
---

:::caution[Requer OpenCode 2]
As políticas não são aplicadas no OpenCode 1. Os exemplos desta página exigem o OpenCode 2. No OpenCode 1, use [`disabled_providers`](/docs/config#disabled-providers) ou [`enabled_providers`](/docs/config#enabled-providers) para controlar a disponibilidade de provedores. Consulte a [documentação de políticas do OpenCode 2](https://opencode.ai/docs/policies/) para o uso atual.
:::

As políticas controlam se o OpenCode pode executar uma ação em um recurso nomeado. Esta funcionalidade do OpenCode 2 é experimental e é configurada com o array `experimental.policies` no `opencode.json`.

As políticas são separadas das [permissões](/docs/permissions). As permissões controlam o que as ferramentas podem fazer durante uma sessão, enquanto as políticas controlam se o OpenCode pode usar um recurso, como um provedor de LLM.

---

## Configuração

Cada declaração de política tem três campos:

- `effect` - `"allow"` ou `"deny"`.
- `action` - A operação que está sendo controlada.
- `resource` - O ID do recurso ou padrão com coringas ao qual a declaração se aplica.

Por exemplo, para negar o uso do provedor `openai`:

```json title="opencode.json"
{
  "$schema": "https://opencode.ai/config.json",
  "experimental": {
    "policies": [
      {
        "effect": "deny",
        "action": "provider.use",
        "resource": "openai"
      }
    ]
  }
}
```

Um provedor negado por uma política não fica disponível para seleção nem uso de modelos, mesmo que tenha credenciais ou esteja configurado corretamente.

---

## Políticas disponíveis

Atualmente, o OpenCode oferece suporte a uma ação de política:

| Ação           | Recurso                       | Descrição                                    |
| -------------- | ----------------------------- | -------------------------------------------- |
| `provider.use` | ID do provedor, como `openai` | Permite ou nega o uso de um provedor de LLM. |

Outras ações de política podem ser adicionadas no futuro.

---

## Correspondência

O campo `resource` oferece suporte a correspondência com coringas. Use `*` para corresponder a zero ou mais caracteres e `?` para corresponder a um caractere.

```json title="opencode.json"
{
  "$schema": "https://opencode.ai/config.json",
  "experimental": {
    "policies": [
      {
        "effect": "deny",
        "action": "provider.use",
        "resource": "company-*"
      }
    ]
  }
}
```

Isso nega provedores como `company-us` e `company-eu`.

---

## Ordem das regras

Quando várias declarações correspondem, a última declaração correspondente vence. Coloque as regras amplas primeiro e, depois delas, as exceções mais específicas.

Por exemplo, para permitir apenas a Anthropic:

```json title="opencode.json"
{
  "$schema": "https://opencode.ai/config.json",
  "experimental": {
    "policies": [
      {
        "effect": "deny",
        "action": "provider.use",
        "resource": "*"
      },
      {
        "effect": "allow",
        "action": "provider.use",
        "resource": "anthropic"
      }
    ]
  }
}
```

Se nenhuma política corresponder a um provedor, o uso do provedor é permitido por padrão.

As políticas podem ser definidas tanto na configuração global quanto na configuração do projeto. Se políticas dos dois locais corresponderem ao mesmo provedor, a política global tem prioridade sobre a política do projeto. Isso impede que um repositório reative um provedor que você negou globalmente.

---

## Listas de provedores

No OpenCode 2, use políticas em vez das configurações mais antigas `disabled_providers` e `enabled_providers` para controlar o acesso a provedores. No OpenCode 1, continue usando essas listas de provedores.

Para substituir `disabled_providers`:

```json title="opencode.json"
{
  "experimental": {
    "policies": [
      { "effect": "deny", "action": "provider.use", "resource": "openai" },
      { "effect": "deny", "action": "provider.use", "resource": "google" }
    ]
  }
}
```

Para substituir `enabled_providers`, negue primeiro todos os provedores e permita os provedores selecionados em seguida:

```json title="opencode.json"
{
  "experimental": {
    "policies": [
      { "effect": "deny", "action": "provider.use", "resource": "*" },
      { "effect": "allow", "action": "provider.use", "resource": "anthropic" },
      { "effect": "allow", "action": "provider.use", "resource": "openai" }
    ]
  }
}
```
