---
title: Politiques
description: Contrôlez les ressources configurées qu'OpenCode peut utiliser.
---

:::caution[Nécessite OpenCode 2]
Les politiques ne sont pas appliquées dans OpenCode 1. Les exemples de cette page nécessitent OpenCode 2. Dans OpenCode 1, utilisez [`disabled_providers`](/docs/config#disabled-providers) ou [`enabled_providers`](/docs/config#enabled-providers) pour contrôler la disponibilité des fournisseurs. Consultez la [documentation des politiques d'OpenCode 2](https://opencode.ai/docs/policies/) pour connaître l'usage actuel.
:::

Les politiques déterminent si OpenCode peut effectuer une action sur une ressource nommée. Cette fonctionnalité d'OpenCode 2 est expérimentale et se configure avec le tableau `experimental.policies` dans `opencode.json`.

Les politiques sont distinctes des [autorisations](/docs/permissions). Les autorisations contrôlent ce que les outils peuvent faire pendant une session, tandis que les politiques déterminent si OpenCode peut utiliser une ressource telle qu'un fournisseur LLM.

---

## Configuration

Chaque déclaration de politique comporte trois champs :

- `effect` - `"allow"` ou `"deny"`.
- `action` - L'opération contrôlée.
- `resource` - L'ID de la ressource ou le modèle à caractères génériques auquel la déclaration s'applique.

Par exemple, pour refuser l'utilisation du fournisseur `openai` :

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

Un fournisseur refusé par une politique n'est pas disponible pour la sélection ou l'utilisation de modèles, même s'il dispose d'identifiants ou s'il est par ailleurs correctement configuré.

---

## Politiques disponibles

OpenCode prend actuellement en charge une seule action de politique :

| Action         | Ressource                         | Description                                            |
| -------------- | --------------------------------- | ------------------------------------------------------ |
| `provider.use` | ID du fournisseur, comme `openai` | Autorise ou refuse l'utilisation d'un fournisseur LLM. |

D'autres actions de politique pourront être ajoutées à l'avenir.

---

## Correspondance

Le champ `resource` prend en charge la correspondance par caractères génériques. Utilisez `*` pour correspondre à zéro ou plusieurs caractères et `?` pour correspondre à un caractère.

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

Cela refuse les fournisseurs tels que `company-us` et `company-eu`.

---

## Ordre des règles

Lorsque plusieurs déclarations correspondent, la dernière déclaration correspondante l'emporte. Placez d'abord les règles générales, puis les exceptions plus spécifiques.

Par exemple, pour autoriser uniquement Anthropic :

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

Si aucune politique ne correspond à un fournisseur, son utilisation est autorisée par défaut.

Les politiques peuvent être définies à la fois dans votre configuration globale et dans la configuration du projet. Si des politiques des deux emplacements correspondent au même fournisseur, votre politique globale a la priorité sur celle du projet. Cela empêche un dépôt de réactiver un fournisseur que vous refusez globalement.

---

## Listes de fournisseurs

Dans OpenCode 2, utilisez les politiques plutôt que les anciens paramètres `disabled_providers` et `enabled_providers` pour contrôler l'accès aux fournisseurs. Continuez à utiliser ces listes de fournisseurs dans OpenCode 1.

Pour remplacer `disabled_providers` :

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

Pour remplacer `enabled_providers`, refusez d'abord tous les fournisseurs, puis autorisez les fournisseurs sélectionnés :

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
