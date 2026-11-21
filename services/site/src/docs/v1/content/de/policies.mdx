---
title: Richtlinien
description: Steuern Sie, welche konfigurierten Ressourcen OpenCode verwenden darf.
---

:::caution[Erfordert OpenCode 2]
Richtlinien werden in OpenCode 1 nicht durchgesetzt. Die Beispiele auf dieser Seite erfordern OpenCode 2. Verwenden Sie in OpenCode 1 [`disabled_providers`](/docs/config#disabled-providers) oder [`enabled_providers`](/docs/config#enabled-providers), um die Verfügbarkeit von Anbietern zu steuern. Die aktuelle Verwendung finden Sie in der [Dokumentation zu Richtlinien in OpenCode 2](https://opencode.ai/docs/policies/).
:::

Richtlinien legen fest, ob OpenCode eine Aktion auf einer benannten Ressource ausführen darf. Diese Funktion von OpenCode 2 ist experimentell und wird über das Array `experimental.policies` in `opencode.json` konfiguriert.

Richtlinien sind von [Berechtigungen](/docs/permissions) getrennt. Berechtigungen steuern, was Tools während einer Sitzung tun dürfen, während Richtlinien steuern, ob OpenCode eine Ressource wie einen LLM-Anbieter verwenden darf.

---

## Konfiguration

Jede Richtlinienanweisung hat drei Felder:

- `effect` - Entweder `"allow"` oder `"deny"`.
- `action` - Der Vorgang, der gesteuert wird.
- `resource` - Die Ressourcen-ID oder das Platzhaltermuster, auf das sich die Anweisung bezieht.

Verweigern Sie beispielsweise die Verwendung des Anbieters `openai`:

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

Ein durch eine Richtlinie verweigerter Anbieter steht weder für die Modellauswahl noch für die Modellnutzung zur Verfügung, selbst wenn Anmeldeinformationen vorhanden sind oder er ansonsten korrekt konfiguriert ist.

---

## Verfügbare Richtlinien

OpenCode unterstützt derzeit eine Richtlinienaktion:

| Aktion         | Ressource                   | Beschreibung                                                 |
| -------------- | --------------------------- | ------------------------------------------------------------ |
| `provider.use` | Anbieter-ID, z. B. `openai` | Die Verwendung eines LLM-Anbieters erlauben oder verweigern. |

Weitere Richtlinienaktionen können künftig hinzukommen.

---

## Abgleich

Das Feld `resource` unterstützt Platzhalterabgleich. Verwenden Sie `*` für null oder mehr beliebige Zeichen und `?` für genau ein Zeichen.

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

Damit werden Anbieter wie `company-us` und `company-eu` verweigert.

---

## Regelreihenfolge

Wenn mehrere Anweisungen übereinstimmen, gewinnt die letzte übereinstimmende Anweisung. Platzieren Sie allgemeine Regeln zuerst und spezifischere Ausnahmen danach.

Erlauben Sie beispielsweise nur Anthropic:

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

Wenn keine Richtlinie auf einen Anbieter zutrifft, ist seine Verwendung standardmäßig erlaubt.

Richtlinien können sowohl in Ihrer globalen Konfiguration als auch in der Projektkonfiguration festgelegt werden. Wenn Richtlinien aus beiden Orten auf denselben Anbieter zutreffen, hat Ihre globale Richtlinie Vorrang vor der Projektrichtlinie. So kann ein Repository keinen Anbieter wieder aktivieren, den Sie global verweigern.

---

## Anbieterlisten

Verwenden Sie in OpenCode 2 Richtlinien statt der älteren Einstellungen `disabled_providers` und `enabled_providers`, um den Zugriff auf Anbieter zu steuern. In OpenCode 1 verwenden Sie weiterhin diese Anbieterlisten.

So ersetzen Sie `disabled_providers`:

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

Um `enabled_providers` zu ersetzen, verweigern Sie zuerst alle Anbieter und erlauben danach die ausgewählten Anbieter:

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
