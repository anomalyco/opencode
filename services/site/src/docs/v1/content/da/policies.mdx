---
title: Politikker
description: Styr, hvilke konfigurerede ressourcer OpenCode må bruge.
---

:::caution[Kræver OpenCode 2]
Politikker håndhæves ikke i OpenCode 1. Eksemplerne på denne side kræver OpenCode 2. I OpenCode 1 skal du bruge [`disabled_providers`](/docs/config#disabled-providers) eller [`enabled_providers`](/docs/config#enabled-providers) til at styre, hvilke udbydere der er tilgængelige. Se [dokumentationen om politikker i OpenCode 2](https://opencode.ai/docs/policies/) for den aktuelle brug.
:::

Politikker styrer, om OpenCode må udføre en handling på en navngiven ressource. Denne funktion i OpenCode 2 er eksperimentel og konfigureres med arrayet `experimental.policies` i `opencode.json`.

Politikker er adskilt fra [tilladelser](/docs/permissions). Tilladelser styrer, hvad værktøjer kan gøre under en session, mens politikker styrer, om OpenCode må bruge en ressource som en LLM-udbyder.

---

## Konfiguration

Hver politikerklæring har tre felter:

- `effect` - Enten `"allow"` eller `"deny"`.
- `action` - Den handling, der styres.
- `resource` - Det ressource-id eller jokertegnsmønster, som erklæringen gælder for.

Afvis for eksempel brugen af udbyderen `openai`:

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

En udbyder, der er afvist af en politik, er ikke tilgængelig til modelvalg eller modelbrug, selvom den har legitimationsoplysninger eller i øvrigt er korrekt konfigureret.

---

## Tilgængelige politikker

OpenCode understøtter i øjeblikket én politikhandling:

| Handling       | Ressource                   | Beskrivelse                                |
| -------------- | --------------------------- | ------------------------------------------ |
| `provider.use` | Udbyder-id, f.eks. `openai` | Tillad eller afvis brug af en LLM-udbyder. |

Flere politikhandlinger kan blive tilføjet i fremtiden.

---

## Matchning

Feltet `resource` understøtter jokertegn-matchning. Brug `*` til at matche nul eller flere tegn og `?` til at matche ét tegn.

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

Dette afviser udbydere som `company-us` og `company-eu`.

---

## Regelrækkefølge

Når flere erklæringer matcher, vinder den sidste matchende erklæring. Sæt brede regler først og mere specifikke undtagelser efter dem.

Tillad for eksempel kun Anthropic:

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

Hvis ingen politik matcher en udbyder, er brugen af udbyderen som standard tilladt.

Politikker kan angives i både din globale konfiguration og din projektkonfiguration. Hvis politikker fra begge steder matcher den samme udbyder, har din globale politik forrang for projektets politik. Det forhindrer et repository i at genaktivere en udbyder, som du har afvist globalt.

---

## Udbyderlister

I OpenCode 2 skal du bruge politikker i stedet for de ældre indstillinger `disabled_providers` og `enabled_providers`, når du styrer adgangen til udbydere. Bliv ved med at bruge disse udbyderlister i OpenCode 1.

Sådan erstatter du `disabled_providers`:

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

Sådan erstatter du `enabled_providers`: afvis først alle udbydere, og tillad derefter de valgte udbydere:

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
