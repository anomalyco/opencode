---
title: Politike
description: Kontrolirajte koje konfigurirane resurse OpenCode smije koristiti.
---

:::caution[Zahtijeva OpenCode 2]
Politike se ne primjenjuju u OpenCode 1. Primjeri na ovoj stranici zahtijevaju OpenCode 2. U OpenCode 1 koristite [`disabled_providers`](/docs/config#disabled-providers) ili [`enabled_providers`](/docs/config#enabled-providers) za kontrolu dostupnosti provajdera. Za trenutnu upotrebu pogledajte [dokumentaciju o politikama za OpenCode 2](https://opencode.ai/docs/policies/).
:::

Politike određuju da li OpenCode smije izvršiti radnju nad imenovanim resursom. Ova funkcija u OpenCode 2 je eksperimentalna i konfiguriše se nizom `experimental.policies` u `opencode.json`.

Politike su odvojene od [dozvola](/docs/permissions). Dozvole kontroliraju šta alati mogu raditi tokom sesije, dok politike kontroliraju da li OpenCode smije koristiti resurs kao što je LLM provajder.

---

## Konfiguracija

Svaka izjava politike ima tri polja:

- `effect` - `"allow"` ili `"deny"`.
- `action` - operacija koja se kontrolira.
- `resource` - ID resursa ili zamjenski uzorak na koji se izjava odnosi.

Na primjer, zabranite upotrebu provajdera `openai`:

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

Provajder zabranjen politikom nije dostupan za odabir ili upotrebu modela, čak i ako ima vjerodajnice ili je inače ispravno konfigurisan.

---

## Dostupne politike

OpenCode trenutno podržava jednu radnju politike:

| Radnja         | Resurs                             | Opis                                               |
| -------------- | ---------------------------------- | -------------------------------------------------- |
| `provider.use` | ID provajdera, na primjer `openai` | Dozvoljava ili zabranjuje upotrebu LLM provajdera. |

U budućnosti mogu biti dodane nove radnje politika.

---

## Podudaranje

Polje `resource` podržava podudaranje zamjenskim znakovima. Koristite `*` za podudaranje nula ili više znakova i `?` za podudaranje tačno jednog znaka.

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

Ovo zabranjuje provajdere kao što su `company-us` i `company-eu`.

---

## Redoslijed pravila

Kada se podudara više izjava, pobjeđuje posljednja izjava koja se podudara. Prvo stavite šira pravila, a nakon njih konkretnije izuzetke.

Na primjer, dozvolite samo Anthropic:

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

Ako se nijedna politika ne podudara s provajderom, njegova upotreba je zadano dozvoljena.

Politike se mogu postaviti i u globalnoj i u projektnoj konfiguraciji. Ako se politike s obje lokacije podudaraju s istim provajderom, vaša globalna politika ima prednost nad projektnom. Time se sprječava da repozitorij ponovo omogući provajdera kojeg ste globalno zabranili.

---

## Liste provajdera

U OpenCode 2 koristite politike umjesto starijih postavki `disabled_providers` i `enabled_providers` kada kontrolirate pristup provajderima. U OpenCode 1 nastavite koristiti te liste provajdera.

Da zamijenite `disabled_providers`:

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

Da zamijenite `enabled_providers`, prvo zabranite sve provajdere, a zatim dozvolite odabrane provajdere:

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
