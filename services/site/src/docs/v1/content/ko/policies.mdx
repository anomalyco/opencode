---
title: 정책
description: OpenCode가 사용할 수 있는 구성된 리소스를 제어합니다.
---

:::caution[OpenCode 2 필요]
OpenCode 1에서는 정책이 적용되지 않습니다. 이 페이지의 예시는 OpenCode 2가 필요합니다. OpenCode 1에서는 [`disabled_providers`](/docs/config#disabled-providers) 또는 [`enabled_providers`](/docs/config#enabled-providers)로 provider 사용 여부를 제어하세요. 현재 사용법은 [OpenCode 2 정책 문서](https://opencode.ai/docs/policies/)를 참고하세요.
:::

정책은 OpenCode가 이름이 지정된 리소스에 대해 작업을 수행할 수 있는지를 제어합니다. 이 OpenCode 2 기능은 실험적 기능이며 `opencode.json`의 `experimental.policies` 배열로 설정합니다.

정책은 [권한](/docs/permissions)과 별개입니다. 권한은 세션 중에 도구가 할 수 있는 일을 제어하고, 정책은 OpenCode가 LLM provider 같은 리소스를 사용할 수 있는지를 제어합니다.

---

## 구성

각 정책 구문에는 세 개의 필드가 있습니다.

- `effect` - `"allow"` 또는 `"deny"`입니다.
- `action` - 제어할 작업입니다.
- `resource` - 구문이 적용될 리소스 ID 또는 와일드카드 패턴입니다.

예를 들어, `openai` provider 사용을 거부하려면 다음과 같이 설정합니다.

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

정책으로 거부된 provider는 자격 증명이 있거나 다른 설정이 올바르더라도 model 선택이나 사용에 쓸 수 없습니다.

---

## 사용 가능한 정책

OpenCode는 현재 하나의 정책 작업을 지원합니다.

| 작업           | 리소스                     | 설명                                       |
| -------------- | -------------------------- | ------------------------------------------ |
| `provider.use` | provider ID (예: `openai`) | LLM provider 사용을 허용하거나 거부합니다. |

향후 더 많은 정책 작업이 추가될 수 있습니다.

---

## 매칭

`resource` 필드는 와일드카드 매칭을 지원합니다. `*`는 0개 이상의 문자와 일치하고 `?`는 문자 하나와 일치합니다.

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

이 설정은 `company-us`, `company-eu` 같은 provider를 거부합니다.

---

## 규칙 순서

여러 구문이 일치하면 마지막으로 일치한 구문이 적용됩니다. 넓은 범위의 규칙을 먼저 두고, 그 뒤에 더 구체적인 예외를 두세요.

예를 들어, Anthropic만 허용하려면 다음과 같이 설정합니다.

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

provider와 일치하는 정책이 없으면 해당 provider 사용은 기본적으로 허용됩니다.

정책은 전역 config와 프로젝트 config 모두에 설정할 수 있습니다. 두 위치의 정책이 같은 provider와 일치하면 전역 정책이 프로젝트 정책보다 우선합니다. 이를 통해 전역으로 거부한 provider를 저장소에서 다시 활성화하지 못하게 합니다.

---

## Provider 목록

OpenCode 2에서 provider 접근을 제어할 때는 이전의 `disabled_providers`, `enabled_providers` 설정 대신 정책을 사용하세요. OpenCode 1에서는 이 provider 목록을 계속 사용하세요.

`disabled_providers`를 대체하려면 다음과 같이 설정합니다.

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

`enabled_providers`를 대체하려면 먼저 모든 provider를 거부한 다음 선택한 provider를 허용하세요.

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
