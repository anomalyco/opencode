---
title: 포매터
description: OpenCode는 언어별 포매터를 사용합니다.
---

OpenCode는 파일을 write하거나 edit한 뒤, 언어별 포매터를 사용해 자동으로 포맷합니다. 이를 통해 생성된 코드가 프로젝트의 코드 스타일을 따르도록 보장합니다.

---

## 내장

OpenCode는 주요 언어와 프레임워크를 위한 여러 내장 포매터를 제공합니다. 아래는 포매터 목록, 지원 확장자, 필요한 명령 또는 config 옵션입니다.

| 포매터               | 확장자                                                                                               | 요구 사항                                                                                             |
| -------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| air                  | .R                                                                                                   | `air` 명령 사용 가능                                                                                  |
| biome                | .js, .jsx, .ts, .tsx, .html, .css, .md, .json, .yaml, [기타](https://biomejs.dev/)                   | `biome.json(c)` config 파일                                                                           |
| cargofmt             | .rs                                                                                                  | `cargo fmt` 명령 사용 가능                                                                            |
| clang-format         | .c, .cpp, .h, .hpp, .ino, [기타](https://clang.llvm.org/docs/ClangFormat.html)                       | `.clang-format` config 파일                                                                           |
| cljfmt               | .clj, .cljs, .cljc, .edn                                                                             | `cljfmt` 명령 사용 가능                                                                               |
| dart                 | .dart                                                                                                | `dart` 명령 사용 가능                                                                                 |
| dfmt                 | .d                                                                                                   | `dfmt` 명령 사용 가능                                                                                 |
| gleam                | .gleam                                                                                               | `gleam` 명령 사용 가능                                                                                |
| gofmt                | .go                                                                                                  | `gofmt` 명령 사용 가능                                                                                |
| htmlbeautifier       | .erb, .html.erb                                                                                      | `htmlbeautifier` 명령 사용 가능                                                                       |
| ktlint               | .kt, .kts                                                                                            | `ktlint` 명령 사용 가능                                                                               |
| mix                  | .ex, .exs, .eex, .heex, .leex, .neex, .sface                                                         | `mix` 명령 사용 가능                                                                                  |
| nixfmt               | .nix                                                                                                 | `nixfmt` 명령 사용 가능                                                                               |
| ocamlformat          | .ml, .mli                                                                                            | `ocamlformat` 명령 사용 가능 및 `.ocamlformat` config 파일 필요                                       |
| ormolu               | .hs                                                                                                  | `ormolu` 명령 사용 가능                                                                               |
| oxfmt (Experimental) | .js, .jsx, .ts, .tsx                                                                                 | `package.json`에 `oxfmt` dependency 필요 및 [experimental env variable flag](/docs/cli/#experimental) |
| pint                 | .php                                                                                                 | `composer.json`에 `laravel/pint` dependency 필요                                                      |
| prettier             | .js, .jsx, .ts, .tsx, .html, .css, .md, .json, .yaml, [기타](https://prettier.io/docs/en/index.html) | `package.json`에 `prettier` dependency 필요                                                           |
| rubocop              | .rb, .rake, .gemspec, .ru                                                                            | `rubocop` 명령 사용 가능                                                                              |
| ruff                 | .py, .pyi                                                                                            | `ruff` 명령 사용 가능 및 관련 config 필요                                                             |
| rustfmt              | .rs                                                                                                  | `rustfmt` 명령 사용 가능                                                                              |
| shfmt                | .sh, .bash                                                                                           | `shfmt` 명령 사용 가능                                                                                |
| standardrb           | .rb, .rake, .gemspec, .ru                                                                            | `standardrb` 명령 사용 가능                                                                           |
| terraform            | .tf, .tfvars                                                                                         | `terraform` 명령 사용 가능                                                                            |
| uv                   | .py, .pyi                                                                                            | `uv` 명령 사용 가능                                                                                   |
| zig                  | .zig, .zon                                                                                           | `zig` 명령 사용 가능                                                                                  |

예를 들어 프로젝트 `package.json`에 `prettier`가 있으면 OpenCode가 자동으로 해당 포매터를 사용합니다.

---

## 작동 방식

OpenCode가 파일을 write하거나 edit할 때 다음 순서로 동작합니다.

1. 활성화된 모든 포매터와 파일 확장자를 대조합니다.
2. 파일에 맞는 포매터 명령을 실행합니다.
3. 포맷 변경 사항을 자동으로 적용합니다.

이 과정은 background에서 실행되며, 수동 작업 없이 코드 스타일이 유지됩니다.

---

## 구성

OpenCode config의 `formatter` 섹션에서 포매터를 커스터마이즈할 수 있습니다.

```json title="opencode.json"
{
  "$schema": "https://opencode.ai/config.json",
  "formatter": {}
}
```

각 formatter 설정에서 지원하는 항목은 다음과 같습니다.

| 속성          | 타입     | 설명                                           |
| ------------- | -------- | ---------------------------------------------- |
| `disabled`    | boolean  | `true`로 설정하면 해당 포매터를 비활성화합니다 |
| `command`     | string[] | 포맷 실행 명령입니다                           |
| `environment` | object   | 포매터 실행 시 설정할 환경 변수입니다          |
| `extensions`  | string[] | 해당 포매터가 처리할 파일 확장자입니다         |

아래 예시를 참고하세요.

---

### 포매터 비활성화

전체 포매터를 전역에서 비활성화하려면 `formatter`를 `false`로 설정하세요.

```json title="opencode.json" {3}
{
  "$schema": "https://opencode.ai/config.json",
  "formatter": false
}
```

특정 포매터만 비활성화하려면 `disabled`를 `true`로 설정하세요.

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

### 사용자 정의 포매터

명령, 환경 변수, 파일 확장자를 지정해 내장 포매터를 override하거나 새 포매터를 추가할 수 있습니다.

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

명령의 **`$FILE` placeholder**는 포맷 대상 파일 경로로 치환됩니다.
