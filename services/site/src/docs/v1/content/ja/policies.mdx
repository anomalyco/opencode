---
title: ポリシー
description: OpenCode が使用できる設定済みリソースを制御します。
---

:::caution[OpenCode 2 が必要です]
OpenCode 1 ではポリシーは適用されません。このページの例には OpenCode 2 が必要です。OpenCode 1 では、[`disabled_providers`](/docs/config#disabled-providers) または [`enabled_providers`](/docs/config#enabled-providers) を使用してプロバイダーの利用可否を制御してください。現在の使い方については、[OpenCode 2 のポリシーのドキュメント](https://opencode.ai/docs/policies/)を参照してください。
:::

ポリシーは、OpenCode が名前付きリソースに対してアクションを実行できるかどうかを制御します。この OpenCode 2 の機能は実験的なもので、`opencode.json` の `experimental.policies` 配列で設定します。

ポリシーは[権限](/docs/permissions)とは別のものです。権限はセッション中にツールが実行できることを制御し、ポリシーは OpenCode が LLM プロバイダーなどのリソースを使用できるかどうかを制御します。

---

## 設定

各ポリシーステートメントには 3 つのフィールドがあります。

- `effect` - `"allow"` または `"deny"` のいずれか。
- `action` - 制御対象の操作。
- `resource` - ステートメントを適用するリソース ID またはワイルドカードパターン。

たとえば、`openai` プロバイダーの使用を拒否するには、次のようにします。

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

ポリシーによって拒否されたプロバイダーは、認証情報があり、その他の設定が正しい場合でも、モデルの選択や使用に利用できません。

---

## 利用可能なポリシー

OpenCode は現在、1 つのポリシーアクションをサポートしています。

| アクション     | リソース                        | 説明                                           |
| -------------- | ------------------------------- | ---------------------------------------------- |
| `provider.use` | プロバイダー ID (`openai` など) | LLM プロバイダーの使用を許可または拒否します。 |

今後、さらにポリシーアクションが追加される可能性があります。

---

## マッチング

`resource` フィールドはワイルドカードマッチングをサポートしています。`*` は 0 個以上の文字に一致し、`?` は 1 文字に一致します。

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

これにより、`company-us` や `company-eu` などのプロバイダーが拒否されます。

---

## ルールの順序

複数のステートメントが一致する場合は、最後に一致したステートメントが優先されます。広範なルールを先に置き、その後により具体的な例外を置いてください。

たとえば、Anthropic のみを許可するには、次のようにします。

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

プロバイダーに一致するポリシーがない場合、そのプロバイダーの使用はデフォルトで許可されます。

ポリシーはグローバル設定とプロジェクト設定の両方で設定できます。両方の場所のポリシーが同じプロバイダーに一致する場合は、グローバルポリシーがプロジェクトポリシーより優先されます。これにより、グローバルで拒否しているプロバイダーをリポジトリが再度有効にすることを防げます。

---

## プロバイダーリスト

OpenCode 2 でプロバイダーへのアクセスを制御する場合は、古い `disabled_providers` および `enabled_providers` 設定の代わりにポリシーを使用してください。OpenCode 1 では、引き続きこれらのプロバイダーリストを使用してください。

`disabled_providers` を置き換えるには、次のようにします。

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

`enabled_providers` を置き換えるには、最初にすべてのプロバイダーを拒否し、その後で選択したプロバイダーを許可します。

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
