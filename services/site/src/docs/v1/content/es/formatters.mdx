---
title: Formateadores
description: OpenCode utiliza formateadores específicos del idioma.
---

OpenCode formatea automáticamente los archivos después de escribirlos o editarlos utilizando formateadores específicos del idioma. Esto garantiza que el código generado siga los estilos de código de su proyecto.

---

## Integrados

OpenCode viene con varios formateadores integrados para lenguajes y marcos populares. A continuación se muestra una lista de los formateadores, las extensiones de archivo compatibles y los comandos u opciones de configuración que necesita.

| Formateador          | Extensiones                                                                                          | Requisitos                                                                                                             |
| -------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| gofmt                | .go                                                                                                  | Comando `gofmt` disponible                                                                                             |
| mix                  | .ex, .exs, .eex, .heex, .leex, .neex, .sface                                                         | Comando `mix` disponible                                                                                               |
| prettier             | .js, .jsx, .ts, .tsx, .html, .css, .md, .json, .yaml y [más](https://prettier.io/docs/en/index.html) | dependencia `prettier` en `package.json`                                                                               |
| biome                | .js, .jsx, .ts, .tsx, .html, .css, .md, .json, .yaml y [más](https://biomejs.dev/)                   | `biome.json(c)` archivo de configuración                                                                               |
| zig                  | .zig, .zon                                                                                           | Comando `zig` disponible                                                                                               |
| clang-format         | .c, .cpp, .h, .hpp, .ino y [más](https://clang.llvm.org/docs/ClangFormat.html)                       | `.clang-format` archivo de configuración                                                                               |
| ktlint               | .kt, .kts                                                                                            | Comando `ktlint` disponible                                                                                            |
| ruff                 | .py, .pyi                                                                                            | Comando `ruff` disponible con configuración                                                                            |
| rustfmt              | .rs                                                                                                  | Comando `rustfmt` disponible                                                                                           |
| cargo fmt            | .rs                                                                                                  | Comando `cargo fmt` disponible                                                                                         |
| uv                   | .py, .pyi                                                                                            | Comando `uv` disponible                                                                                                |
| rubocop              | .rb, .rake, .gemspec, .ru                                                                            | Comando `rubocop` disponible                                                                                           |
| standardrb           | .rb, .rake, .gemspec, .ru                                                                            | Comando `standardrb` disponible                                                                                        |
| htmlbeautifier       | .erb, .html.erb                                                                                      | Comando `htmlbeautifier` disponible                                                                                    |
| air                  | .R                                                                                                   | Comando `air` disponible                                                                                               |
| dart                 | .dart                                                                                                | Comando `dart` disponible                                                                                              |
| dfmt                 | .d                                                                                                   | Comando `dfmt` disponible                                                                                              |
| ocamlformat          | .ml, .mli                                                                                            | Comando `ocamlformat` disponible y archivo de configuración `.ocamlformat`                                             |
| terraform            | .tf, .tfvars                                                                                         | Comando `terraform` disponible                                                                                         |
| gleam                | .gleam                                                                                               | Comando `gleam` disponible                                                                                             |
| nixfmt               | .nix                                                                                                 | Comando `nixfmt` disponible                                                                                            |
| shfmt                | .sh, .bash                                                                                           | Comando `shfmt` disponible                                                                                             |
| pint                 | .php                                                                                                 | dependencia `laravel/pint` en `composer.json`                                                                          |
| oxfmt (Experimental) | .js, .jsx, .ts, .tsx                                                                                 | Dependencia de `oxfmt` en `package.json` y un [indicador de variable de entorno experimental](/docs/cli/#experimental) |
| ormolu               | .hs                                                                                                  | Comando `ormolu` disponible                                                                                            |

Entonces, si su proyecto tiene `prettier` en su `package.json`, OpenCode lo usará automáticamente.

---

## Cómo funciona

Cuando OpenCode escribe o edita un archivo:

1. Comprueba la extensión del archivo con todos los formateadores habilitados.
2. Ejecuta el comando de formateo apropiado en el archivo.
3. Aplica los cambios de formato automáticamente.

Este proceso ocurre en segundo plano, lo que garantiza que los estilos de su código se mantengan sin ningún paso manual.

---

## Configuración

Puede personalizar los formateadores a través de la sección `formatter` en su configuración OpenCode.

```json title="opencode.json"
{
  "$schema": "https://opencode.ai/config.json",
  "formatter": {}
}
```

Cada configuración del formateador admite lo siguiente:

| Propiedad     | Tipo     | Descripción                                                     |
| ------------- | -------- | --------------------------------------------------------------- |
| `disabled`    | booleano | Establezca esto en `true` para deshabilitar el formateador      |
| `command`     | cadena[] | El comando a ejecutar para formatear                            |
| `environment` | objeto   | Variables de entorno para configurar al ejecutar el formateador |
| `extensions`  | cadena[] | Extensiones de archivo que este formateador debería manejar     |

Veamos algunos ejemplos.

---

### Deshabilitar formateadores

Para deshabilitar **todos** los formateadores globalmente, configure `formatter` en `false`:

```json title="opencode.json" {3}
{
  "$schema": "https://opencode.ai/config.json",
  "formatter": false
}
```

Para deshabilitar un formateador **específico**, establezca `disabled` en `true`:

```json title="opencode.json" {5}
{
  "$schema": "https://opencode.ai/config.json",
  "formatter": {
    "prettier": {
      "disabled": true
    }
  }
}
```

---

### Formateadores personalizados

Puede anular los formateadores integrados o agregar otros nuevos especificando el comando, las variables de entorno y las extensiones de archivo:

```json title="opencode.json" {4-14}
{
  "$schema": "https://opencode.ai/config.json",
  "formatter": {
    "prettier": {
      "command": ["npx", "prettier", "--write", "$FILE"],
      "environment": {
        "NODE_ENV": "development"
      },
      "extensions": [".js", ".ts", ".jsx", ".tsx"]
    },
    "custom-markdown-formatter": {
      "command": ["deno", "fmt", "$FILE"],
      "extensions": [".md"]
    }
  }
}
```

El marcador de posición **`$FILE`** en el comando se reemplazará con la ruta al archivo que se está formateando.
