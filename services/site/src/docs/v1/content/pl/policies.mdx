---
title: Polityki
description: Kontroluj, z których skonfigurowanych zasobów może korzystać OpenCode.
---

:::caution[Wymaga OpenCode 2]
Polityki nie są egzekwowane w OpenCode 1. Przykłady na tej stronie wymagają OpenCode 2. W OpenCode 1 użyj [`disabled_providers`](/docs/config#disabled-providers) lub [`enabled_providers`](/docs/config#enabled-providers), aby kontrolować dostępność dostawców. Aktualne informacje znajdziesz w [dokumentacji polityk OpenCode 2](https://opencode.ai/docs/policies/).
:::

Polityki określają, czy OpenCode może wykonać daną akcję na wskazanym zasobie. Ta funkcja OpenCode 2 jest eksperymentalna i konfiguruje się ją za pomocą tablicy `experimental.policies` w `opencode.json`.

Polityki są niezależne od [uprawnień](/docs/permissions). Uprawnienia kontrolują, co narzędzia mogą robić w trakcie sesji, a polityki decydują, czy OpenCode może korzystać z zasobu, takiego jak dostawca LLM.

---

## Konfiguracja

Każda reguła polityki ma trzy pola:

- `effect` - `"allow"` albo `"deny"`.
- `action` - Kontrolowana operacja.
- `resource` - Identyfikator zasobu lub wzorzec z symbolami wieloznacznymi, którego dotyczy reguła.

Na przykład zablokuj korzystanie z dostawcy `openai`:

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

Dostawca zablokowany przez politykę nie jest dostępny do wyboru ani używania modeli, nawet jeśli ma dane uwierzytelniające lub jest poprawnie skonfigurowany.

---

## Dostępne polityki

OpenCode obsługuje obecnie jedną akcję polityki:

| Akcja          | Zasób                                | Opis                                                  |
| -------------- | ------------------------------------ | ----------------------------------------------------- |
| `provider.use` | Identyfikator dostawcy, np. `openai` | Zezwala na korzystanie z dostawcy LLM lub go blokuje. |

W przyszłości mogą zostać dodane kolejne akcje polityk.

---

## Dopasowywanie

Pole `resource` obsługuje dopasowywanie z symbolami wieloznacznymi. Użyj `*`, aby dopasować zero lub więcej znaków, oraz `?`, aby dopasować jeden znak.

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

Ta reguła blokuje dostawców takich jak `company-us` i `company-eu`.

---

## Kolejność reguł

Gdy pasuje kilka reguł, wygrywa ostatnia pasująca. Umieść najpierw reguły ogólne, a po nich bardziej szczegółowe wyjątki.

Na przykład zezwól tylko na Anthropic:

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

Jeśli żadna polityka nie pasuje do dostawcy, korzystanie z niego jest domyślnie dozwolone.

Polityki można ustawić zarówno w konfiguracji globalnej, jak i w konfiguracji projektu. Jeśli polityki z obu miejsc pasują do tego samego dostawcy, polityka globalna ma pierwszeństwo przed polityką projektu. Dzięki temu repozytorium nie może ponownie włączyć dostawcy, którego zablokowałeś globalnie.

---

## Listy dostawców

W OpenCode 2 do kontrolowania dostępu do dostawców używaj polityk zamiast starszych ustawień `disabled_providers` i `enabled_providers`. W OpenCode 1 nadal korzystaj z tych list dostawców.

Aby zastąpić `disabled_providers`:

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

Aby zastąpić `enabled_providers`, najpierw zablokuj wszystkich dostawców, a następnie zezwól na wybranych:

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
