---
title: Политики
description: Управляйте тем, какие настроенные ресурсы может использовать OpenCode.
---

:::caution[Требуется OpenCode 2]
В OpenCode 1 политики не применяются. Примеры на этой странице требуют OpenCode 2. В OpenCode 1 используйте [`disabled_providers`](/docs/config#disabled-providers) или [`enabled_providers`](/docs/config#enabled-providers), чтобы управлять доступностью поставщиков. Актуальные сведения см. в [документации по политикам OpenCode 2](https://opencode.ai/docs/policies/).
:::

Политики определяют, может ли OpenCode выполнить действие над именованным ресурсом. Эта функция OpenCode 2 экспериментальная и настраивается с помощью массива `experimental.policies` в `opencode.json`.

Политики существуют отдельно от [разрешений](/docs/permissions). Разрешения управляют тем, что инструменты могут делать во время сеанса, а политики — тем, может ли OpenCode использовать ресурс, например поставщика LLM.

---

## Конфигурация

Каждое правило политики содержит три поля:

- `effect` - `"allow"` или `"deny"`.
- `action` - Контролируемая операция.
- `resource` - Идентификатор ресурса или шаблон с подстановочными знаками, к которому применяется правило.

Например, запретите использование поставщика `openai`:

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

Поставщик, запрещенный политикой, недоступен для выбора и использования моделей, даже если для него есть учетные данные или он настроен правильно во всем остальном.

---

## Доступные политики

Сейчас OpenCode поддерживает одно действие политики:

| Действие       | Ресурс                                      | Описание                                              |
| -------------- | ------------------------------------------- | ----------------------------------------------------- |
| `provider.use` | Идентификатор поставщика, например `openai` | Разрешает или запрещает использование поставщика LLM. |

В будущем могут появиться и другие действия политик.

---

## Сопоставление

Поле `resource` поддерживает сопоставление с подстановочными знаками. Используйте `*`, чтобы сопоставить ноль или более символов, и `?`, чтобы сопоставить один символ.

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

Это правило запрещает таких поставщиков, как `company-us` и `company-eu`.

---

## Порядок правил

Если совпадает несколько правил, побеждает последнее совпавшее. Сначала размещайте общие правила, а после них — более конкретные исключения.

Например, разрешите только Anthropic:

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

Если ни одна политика не совпадает с поставщиком, его использование по умолчанию разрешено.

Политики можно задавать как в глобальной конфигурации, так и в конфигурации проекта. Если политики из обоих мест совпадают с одним и тем же поставщиком, глобальная политика имеет приоритет над политикой проекта. Это не позволяет репозиторию снова включить поставщика, которого вы запретили глобально.

---

## Списки поставщиков

В OpenCode 2 для управления доступом к поставщикам используйте политики вместо старых настроек `disabled_providers` и `enabled_providers`. В OpenCode 1 продолжайте использовать эти списки поставщиков.

Чтобы заменить `disabled_providers`:

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

Чтобы заменить `enabled_providers`, сначала запретите всех поставщиков, а затем разрешите выбранных:

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
