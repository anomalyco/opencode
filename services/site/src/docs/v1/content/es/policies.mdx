---
title: Políticas
description: Controle qué recursos configurados puede usar OpenCode.
---

:::caution[Requiere OpenCode 2]
Las políticas no se aplican en OpenCode 1. Los ejemplos de esta página requieren OpenCode 2. En OpenCode 1, use [`disabled_providers`](/docs/config#disabled-providers) o [`enabled_providers`](/docs/config#enabled-providers) para controlar la disponibilidad de los proveedores. Consulte la [documentación de políticas de OpenCode 2](https://opencode.ai/docs/policies/) para conocer el uso actual.
:::

Las políticas controlan si OpenCode puede realizar una acción sobre un recurso con nombre. Esta función de OpenCode 2 es experimental y se configura con el array `experimental.policies` en `opencode.json`.

Las políticas son independientes de los [permisos](/docs/permissions). Los permisos controlan lo que pueden hacer las herramientas durante una sesión, mientras que las políticas controlan si OpenCode puede usar un recurso como un proveedor de LLM.

---

## Configuración

Cada declaración de política tiene tres campos:

- `effect` - `"allow"` o `"deny"`.
- `action` - La operación que se controla.
- `resource` - El ID del recurso o el patrón con comodines al que se aplica la declaración.

Por ejemplo, para denegar el uso del proveedor `openai`:

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

Un proveedor denegado por una política no está disponible para seleccionar ni usar modelos, aunque tenga credenciales o esté configurado correctamente en todo lo demás.

---

## Políticas disponibles

Actualmente, OpenCode admite una acción de política:

| Acción         | Recurso                                | Descripción                                      |
| -------------- | -------------------------------------- | ------------------------------------------------ |
| `provider.use` | ID del proveedor, por ejemplo `openai` | Permite o deniega el uso de un proveedor de LLM. |

Es posible que se añadan más acciones de política en el futuro.

---

## Coincidencia

El campo `resource` admite coincidencia con comodines. Use `*` para coincidir con cero o más caracteres y `?` para coincidir con un solo carácter.

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

Esto deniega proveedores como `company-us` y `company-eu`.

---

## Orden de las reglas

Cuando coinciden varias declaraciones, gana la última declaración coincidente. Coloque primero las reglas generales y después las excepciones más específicas.

Por ejemplo, para permitir solo Anthropic:

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

Si ninguna política coincide con un proveedor, su uso está permitido de forma predeterminada.

Las políticas pueden establecerse tanto en su configuración global como en la configuración del proyecto. Si políticas de ambas ubicaciones coinciden con el mismo proveedor, su política global tiene prioridad sobre la del proyecto. Así se evita que un repositorio vuelva a habilitar un proveedor que usted deniega globalmente.

---

## Listas de proveedores

En OpenCode 2, use políticas en lugar de las opciones anteriores `disabled_providers` y `enabled_providers` para controlar el acceso a los proveedores. En OpenCode 1, siga usando esas listas de proveedores.

Para reemplazar `disabled_providers`:

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

Para reemplazar `enabled_providers`, deniegue primero todos los proveedores y después permita los proveedores seleccionados:

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
