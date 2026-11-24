---
title: Policy
description: Controlla quali risorse configurate può usare OpenCode.
---

:::caution[Richiede OpenCode 2]
Le policy non vengono applicate in OpenCode 1. Gli esempi in questa pagina richiedono OpenCode 2. In OpenCode 1, usa [`disabled_providers`](/docs/config#disabled-providers) o [`enabled_providers`](/docs/config#enabled-providers) per controllare la disponibilità dei provider. Consulta la [documentazione delle policy di OpenCode 2](https://opencode.ai/docs/policies/) per l'utilizzo attuale.
:::

Le policy controllano se OpenCode può eseguire un'azione su una risorsa specifica. Questa funzionalità di OpenCode 2 è sperimentale e si configura con l'array `experimental.policies` in `opencode.json`.

Le policy sono distinte dai [permessi](/docs/permissions). I permessi controllano cosa possono fare gli strumenti durante una sessione, mentre le policy controllano se OpenCode può usare una risorsa come un provider LLM.

---

## Configurazione

Ogni dichiarazione di policy ha tre campi:

- `effect` - `"allow"` oppure `"deny"`.
- `action` - L'operazione controllata.
- `resource` - L'ID della risorsa o il pattern con wildcard a cui si applica la dichiarazione.

Per esempio, per negare l'uso del provider `openai`:

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

Un provider negato da una policy non è disponibile per la selezione o l'uso dei modelli, anche se ha le credenziali o è comunque configurato correttamente.

---

## Policy disponibili

Attualmente OpenCode supporta una sola azione di policy:

| Azione         | Risorsa                              | Descrizione                               |
| -------------- | ------------------------------------ | ----------------------------------------- |
| `provider.use` | ID del provider, ad esempio `openai` | Consente o nega l'uso di un provider LLM. |

In futuro potrebbero essere aggiunte altre azioni di policy.

---

## Corrispondenza

Il campo `resource` supporta il matching con wildcard. Usa `*` per far corrispondere zero o più caratteri e `?` per far corrispondere un carattere.

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

Questo nega provider come `company-us` e `company-eu`.

---

## Ordine delle regole

Quando più dichiarazioni corrispondono, vince l'ultima dichiarazione corrispondente. Metti prima le regole generali e poi le eccezioni più specifiche.

Per esempio, per consentire solo Anthropic:

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

Se nessuna policy corrisponde a un provider, l'uso del provider è consentito di default.

Le policy possono essere impostate sia nella configurazione globale sia in quella di progetto. Se policy di entrambe le posizioni corrispondono allo stesso provider, la policy globale ha la precedenza su quella di progetto. Questo impedisce a un repository di riabilitare un provider che hai negato globalmente.

---

## Elenchi di provider

In OpenCode 2, usa le policy al posto delle vecchie impostazioni `disabled_providers` e `enabled_providers` per controllare l'accesso ai provider. In OpenCode 1 continua a usare questi elenchi di provider.

Per sostituire `disabled_providers`:

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

Per sostituire `enabled_providers`, nega prima tutti i provider e poi consenti quelli selezionati:

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
