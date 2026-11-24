---
title: 策略
description: 控制 OpenCode 可以使用哪些已配置的资源。
---

:::caution[需要 OpenCode 2]
OpenCode 1 不会执行策略。本页中的示例需要 OpenCode 2。在 OpenCode 1 中，请使用 [`disabled_providers`](/docs/config#disabled-providers) 或 [`enabled_providers`](/docs/config#enabled-providers) 来控制提供商的可用性。当前用法请参阅 [OpenCode 2 策略文档](https://opencode.ai/docs/policies/)。
:::

策略用于控制 OpenCode 是否可以对指定资源执行某个操作。这是 OpenCode 2 的实验性功能，通过 `opencode.json` 中的 `experimental.policies` 数组进行配置。

策略与[权限](/docs/permissions)相互独立。权限控制工具在会话中可以做什么，而策略控制 OpenCode 是否可以使用某个资源，例如 LLM 提供商。

---

## 配置

每条策略语句包含三个字段：

- `effect` - `"allow"` 或 `"deny"`。
- `action` - 要控制的操作。
- `resource` - 该语句适用的资源 ID 或通配符模式。

例如，禁止使用 `openai` 提供商：

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

被策略禁止的提供商无法用于模型选择或模型调用，即使它已有凭据或其他配置都正确。

---

## 可用策略

OpenCode 目前支持一种策略操作：

| 操作           | 资源                     | 说明                            |
| -------------- | ------------------------ | ------------------------------- |
| `provider.use` | 提供商 ID，例如 `openai` | 允许或禁止使用某个 LLM 提供商。 |

未来可能会添加更多策略操作。

---

## 匹配

`resource` 字段支持通配符匹配。使用 `*` 匹配零个或多个字符，使用 `?` 匹配一个字符。

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

这会禁止 `company-us` 和 `company-eu` 等提供商。

---

## 规则顺序

当多条语句匹配时，最后一条匹配的语句生效。先写宽泛的规则，再在后面写更具体的例外规则。

例如，只允许 Anthropic：

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

如果没有任何策略匹配某个提供商，则默认允许使用该提供商。

策略可以同时在全局配置和项目配置中设置。如果两处的策略都匹配同一个提供商，全局策略优先于项目策略。这样可以防止某个仓库重新启用你在全局禁止的提供商。

---

## 提供商列表

在 OpenCode 2 中，控制提供商访问时请使用策略，而不是旧的 `disabled_providers` 和 `enabled_providers` 设置。在 OpenCode 1 中请继续使用这些提供商列表。

替代 `disabled_providers`：

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

替代 `enabled_providers` 时，先禁止所有提供商，再在其后允许选定的提供商：

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
