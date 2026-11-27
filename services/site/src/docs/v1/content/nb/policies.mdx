---
title: Policyer
description: Kontroller hvilke konfigurerte ressurser OpenCode kan bruke.
---

:::caution[Krever OpenCode 2]
Policyer håndheves ikke i OpenCode 1. Eksemplene på denne siden krever OpenCode 2. I OpenCode 1 bruker du [`disabled_providers`](/docs/config#disabled-providers) eller [`enabled_providers`](/docs/config#enabled-providers) for å styre hvilke leverandører som er tilgjengelige. Se [dokumentasjonen for policyer i OpenCode 2](https://opencode.ai/docs/policies/) for gjeldende bruk.
:::

Policyer bestemmer om OpenCode kan utføre en handling på en navngitt ressurs. Denne funksjonen i OpenCode 2 er eksperimentell og konfigureres med `experimental.policies`-listen i `opencode.json`.

Policyer er atskilt fra [tillatelser](/docs/permissions). Tillatelser styrer hva verktøy kan gjøre i løpet av en økt, mens policyer styrer om OpenCode kan bruke en ressurs, for eksempel en LLM-leverandør.

---

## Konfigurasjon

Hver policysetning har tre felt:

- `effect` - Enten `"allow"` eller `"deny"`.
- `action` - Operasjonen som styres.
- `resource` - Ressurs-ID-en eller jokertegnmønsteret setningen gjelder for.

For eksempel kan du nekte bruk av leverandøren `openai`:

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

En leverandør som er nektet av en policy, er ikke tilgjengelig for modellvalg eller modellbruk, selv om den har legitimasjon eller ellers er riktig konfigurert.

---

## Tilgjengelige policyer

OpenCode støtter for øyeblikket én policyhandling:

| Handling       | Ressurs                              | Beskrivelse                                  |
| -------------- | ------------------------------------ | -------------------------------------------- |
| `provider.use` | Leverandør-ID, for eksempel `openai` | Tillat eller nekt bruk av en LLM-leverandør. |

Flere policyhandlinger kan bli lagt til i fremtiden.

---

## Samsvar

Feltet `resource` støtter jokertegnsamsvar. Bruk `*` for å matche null eller flere tegn og `?` for å matche ett tegn.

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

Dette nekter leverandører som `company-us` og `company-eu`.

---

## Regelrekkefølge

Når flere setninger samsvarer, vinner den siste samsvarende setningen. Sett brede regler først, og legg mer spesifikke unntak etter dem.

For eksempel kan du bare tillate Anthropic:

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

Hvis ingen policy samsvarer med en leverandør, er bruk av leverandøren tillatt som standard.

Policyer kan angis både i den globale konfigurasjonen og i prosjektkonfigurasjonen. Hvis policyer fra begge steder samsvarer med samme leverandør, har den globale policyen forrang over prosjektpolicyen. Dette hindrer et repository i å aktivere en leverandør som du har nektet globalt.

---

## Leverandørlister

I OpenCode 2 bruker du policyer i stedet for de eldre innstillingene `disabled_providers` og `enabled_providers` når du styrer tilgang til leverandører. Fortsett å bruke disse leverandørlistene i OpenCode 1.

Slik erstatter du `disabled_providers`:

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

For å erstatte `enabled_providers` nekter du først alle leverandører og tillater deretter de valgte leverandørene:

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
