---
title: 政策
description: 控制 OpenCode 可以使用哪些已設定的資源。
---

:::caution[需要 OpenCode 2]
OpenCode 1 不會執行政策。本頁中的範例需要 OpenCode 2。在 OpenCode 1 中，請使用 [`disabled_providers`](/docs/config#disabled-providers) 或 [`enabled_providers`](/docs/config#enabled-providers) 來控制供應商的可用性。目前的用法請參閱 [OpenCode 2 政策文件](https://opencode.ai/docs/policies/)。
:::

政策用於控制 OpenCode 是否可以對指定資源執行某個操作。這是 OpenCode 2 的實驗性功能，透過 `opencode.json` 中的 `experimental.policies` 陣列進行設定。

政策與[權限](/docs/permissions)彼此獨立。權限控制工具在工作階段中可以做什麼，而政策控制 OpenCode 是否可以使用某個資源，例如 LLM 供應商。

---

## 設定

每條政策陳述式包含三個欄位：

- `effect` - `"allow"` 或 `"deny"`。
- `action` - 要控制的操作。
- `resource` - 該陳述式適用的資源 ID 或萬用字元模式。

例如，禁止使用 `openai` 供應商：

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

被政策禁止的供應商無法用於模型選擇或模型呼叫，即使它已有憑證或其他設定都正確。

---

## 可用政策

OpenCode 目前支援一種政策操作：

| 操作           | 資源                     | 說明                            |
| -------------- | ------------------------ | ------------------------------- |
| `provider.use` | 供應商 ID，例如 `openai` | 允許或禁止使用某個 LLM 供應商。 |

未來可能會新增更多政策操作。

---

## 比對

`resource` 欄位支援萬用字元比對。使用 `*` 比對零個或多個字元，使用 `?` 比對一個字元。

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

這會禁止 `company-us` 和 `company-eu` 等供應商。

---

## 規則順序

當多條陳述式比對成功時，最後一條比對的陳述式生效。先寫廣泛的規則，再在後面寫更具體的例外規則。

例如，只允許 Anthropic：

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

如果沒有任何政策比對到某個供應商，則預設允許使用該供應商。

政策可以同時在全域設定和專案設定中設定。如果兩處的政策都比對到同一個供應商，全域政策優先於專案政策。這樣可以防止某個儲存庫重新啟用您在全域禁止的供應商。

---

## 供應商清單

在 OpenCode 2 中，控制供應商存取時請使用政策，而不是舊的 `disabled_providers` 和 `enabled_providers` 設定。在 OpenCode 1 中請繼續使用這些供應商清單。

取代 `disabled_providers`：

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

取代 `enabled_providers` 時，先禁止所有供應商，再在其後允許選定的供應商：

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
