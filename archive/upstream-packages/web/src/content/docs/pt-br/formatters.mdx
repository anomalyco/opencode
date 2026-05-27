---
title: Formatadores
description: O opencode usa formatadores específicos de linguagem.
---

O opencode formata automaticamente arquivos após serem escritos ou editados usando formatadores específicos de linguagem. Isso garante que o código gerado siga os estilos de código do seu projeto.

---

## Integrados

O opencode vem com vários formatadores integrados para linguagens e frameworks populares. Abaixo está uma lista dos formatadores, extensões de arquivo suportadas e comandos ou opções de configuração necessárias.

| Formatador           | Extensões                                                                                              | Requisitos                                                                                               |
| -------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| gofmt                | .go                                                                                                    | Comando `gofmt` disponível                                                                               |
| mix                  | .ex, .exs, .eex, .heex, .leex, .neex, .sface                                                           | Comando `mix` disponível                                                                                 |
| prettier             | .js, .jsx, .ts, .tsx, .html, .css, .md, .json, .yaml, e [mais](https://prettier.io/docs/en/index.html) | Dependência `prettier` em `package.json`                                                                 |
| biome                | .js, .jsx, .ts, .tsx, .html, .css, .md, .json, .yaml, e [mais](https://biomejs.dev/)                   | Arquivo de configuração `biome.json(c)`                                                                  |
| zig                  | .zig, .zon                                                                                             | Comando `zig` disponível                                                                                 |
| clang-format         | .c, .cpp, .h, .hpp, .ino, e [mais](https://clang.llvm.org/docs/ClangFormat.html)                       | Arquivo de configuração `.clang-format`                                                                  |
| ktlint               | .kt, .kts                                                                                              | Comando `ktlint` disponível                                                                              |
| ruff                 | .py, .pyi                                                                                              | Comando `ruff` disponível com configuração                                                               |
| rustfmt              | .rs                                                                                                    | Comando `rustfmt` disponível                                                                             |
| cargofmt             | .rs                                                                                                    | Comando `cargo fmt` disponível                                                                           |
| uv                   | .py, .pyi                                                                                              | Comando `uv` disponível                                                                                  |
| rubocop              | .rb, .rake, .gemspec, .ru                                                                              | Comando `rubocop` disponível                                                                             |
| standardrb           | .rb, .rake, .gemspec, .ru                                                                              | Comando `standardrb` disponível                                                                          |
| htmlbeautifier       | .erb, .html.erb                                                                                        | Comando `htmlbeautifier` disponível                                                                      |
| air                  | .R                                                                                                     | Comando `air` disponível                                                                                 |
| dart                 | .dart                                                                                                  | Comando `dart` disponível                                                                                |
| dfmt                 | .d                                                                                                     | Comando `dfmt` disponível                                                                                |
| ocamlformat          | .ml, .mli                                                                                              | Comando `ocamlformat` disponível e arquivo de configuração `.ocamlformat`                                |
| terraform            | .tf, .tfvars                                                                                           | Comando `terraform` disponível                                                                           |
| gleam                | .gleam                                                                                                 | Comando `gleam` disponível                                                                               |
| nixfmt               | .nix                                                                                                   | Comando `nixfmt` disponível                                                                              |
| shfmt                | .sh, .bash                                                                                             | Comando `shfmt` disponível                                                                               |
| pint                 | .php                                                                                                   | Dependência `laravel/pint` em `composer.json`                                                            |
| oxfmt (Experimental) | .js, .jsx, .ts, .tsx                                                                                   | Dependência `oxfmt` em `package.json` e uma [variável de ambiente experimental](/docs/cli/#experimental) |
| ormolu               | .hs                                                                                                    | Comando `ormolu` disponível                                                                              |

Portanto, se seu projeto tiver `prettier` em seu `package.json`, o opencode o usará automaticamente.

---

## Como funciona

Quando o opencode escreve ou edita um arquivo, ele:

1. Verifica a extensão do arquivo em relação a todos os formatadores habilitados.
2. Executa o comando do formatador apropriado no arquivo.
3. Aplica as alterações de formatação automaticamente.

Esse processo acontece em segundo plano, garantindo que seus estilos de código sejam mantidos sem etapas manuais.

---

## Configuração

Você pode personalizar os formatadores através da seção `formatter` em sua configuração do opencode.

```json title="opencode.json"
{
  "$schema": "https://opencode.ai/config.json",
  "formatter": {}
}
```

Cada configuração de formatador suporta o seguinte:

| Propriedade   | Tipo     | Descrição                                                        |
| ------------- | -------- | ---------------------------------------------------------------- |
| `disabled`    | boolean  | Defina como `true` para desabilitar o formatador                 |
| `command`     | string[] | O comando a ser executado para formatação                        |
| `environment` | object   | Variáveis de ambiente a serem definidas ao executar o formatador |
| `extensions`  | string[] | Extensões de arquivo que este formatador deve tratar             |

Vamos ver alguns exemplos.

---

### Desabilitando formatadores

Para desabilitar **todos** os formatadores globalmente, defina `formatter` como `false`:

```json title="opencode.json" {3}
{
  "$schema": "https://opencode.ai/config.json",
  "formatter": false
}
```

Para desabilitar um **formatador específico**, defina `disabled` como `true`:

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

### Formatadores personalizados

Você pode substituir os formatadores integrados ou adicionar novos especificando o comando, variáveis de ambiente e extensões de arquivo:

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

O **placeholder `$FILE`** no comando será substituído pelo caminho do arquivo que está sendo formatado.
