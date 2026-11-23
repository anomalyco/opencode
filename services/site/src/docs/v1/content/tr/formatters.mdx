---
title: Biçimlendiriciler
description: opencode dile özgü biçimlendiriciler kullanır.
---

opencode, dosyaları dile özgü formatlayıcılar kullanılarak yazıldıktan veya düzenlendikten sonra otomatik olarak formatlar. Bu, oluşturulan kodun projenizin kod stillerine uymasını sağlar.

---

## Yerleşik

opencode, popüler diller ve çerçeveler için çeşitli yerleşik biçimlendiricilerle birlikte gelir. Aşağıda ihtiyaç duyduğu biçimlendiricilerin, desteklenen dosya uzantılarının ve komutların veya yapılandırma seçeneklerinin bir listesi bulunmaktadır.

| Biçimlendirici   | Uzantılar                                                                                                    | Gereksinimler                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| gofmt            | .go                                                                                                          | `gofmt` komutu mevcut                                                                                  |
| mix              | .ex, .exs, .eex, .heex, .leex, .neex, .sface                                                                 | `mix` komutu mevcut                                                                                    |
| prettier         | .js, .jsx, .ts, .tsx, .html, .css, .md, .json, .yaml ve [daha fazla](https://prettier.io/docs/en/index.html) | `package.json` içinde `prettier` bağımlılığı                                                           |
| biome            | .js, .jsx, .ts, .tsx, .html, .css, .md, .json, .yaml ve [daha fazla](https://biomejs.dev/)                   | `biome.json(c)` yapılandırma dosyası                                                                   |
| zig              | .zig, .zon                                                                                                   | `zig` komutu mevcut                                                                                    |
| clang-format     | .c, .cpp, .h, .hpp, .ino ve [daha fazla](https://clang.llvm.org/docs/ClangFormat.html)                       | `.clang-format` yapılandırma dosyası                                                                   |
| ktlint           | .kt, .kts                                                                                                    | `ktlint` komutu mevcut                                                                                 |
| ruff             | .py, .pyi                                                                                                    | `ruff` komutu yapılandırmayla kullanılabilir                                                           |
| rustfmt          | .rs                                                                                                          | `rustfmt` komutu mevcut                                                                                |
| cargofmt         | .rs                                                                                                          | `cargo fmt` komutu mevcut                                                                              |
| uv               | .py, .pyi                                                                                                    | `uv` komutu mevcut                                                                                     |
| rubocop          | .rb, .rake, .gemspec, .ru                                                                                    | `rubocop` komutu mevcut                                                                                |
| standardrb       | .rb, .rake, .gemspec, .ru                                                                                    | `standardrb` komutu mevcut                                                                             |
| htmlbeautifier   | .erb, .html.erb                                                                                              | `htmlbeautifier` komutu mevcut                                                                         |
| air              | .R                                                                                                           | `air` komutu mevcut                                                                                    |
| dart             | .dart                                                                                                        | `dart` komutu mevcut                                                                                   |
| dfmt             | .d                                                                                                           | `dfmt` komutu mevcut                                                                                   |
| ocamlformat      | .ml, .mli                                                                                                    | `ocamlformat` komutu mevcut ve `.ocamlformat` yapılandırma dosyası                                     |
| terraform        | .tf, .tfvars                                                                                                 | `terraform` komutu mevcut                                                                              |
| gleam            | .gleam                                                                                                       | `gleam` komutu mevcut                                                                                  |
| nixfmt           | .nix                                                                                                         | `nixfmt` komutu mevcut                                                                                 |
| shfmt            | .sh, .bash                                                                                                   | `shfmt` komutu mevcut                                                                                  |
| pint             | .php                                                                                                         | `composer.json` içinde `laravel/pint` bağımlılığı                                                      |
| oxfmt (Deneysel) | .js, .jsx, .ts, .tsx                                                                                         | `package.json` içinde `oxfmt` bağımlılığı ve [experimental env variable flag](/docs/cli/#experimental) |
| ormolu           | .hs                                                                                                          | `ormolu` komutu mevcut                                                                                 |

Yani eğer projenizin `package.json` dosyasında `prettier` varsa, opencode bunu otomatik olarak kullanacaktır.

---

## Nasıl çalışır?

opencode bir dosyayı yazdığında veya düzenlediğinde:

1. Dosya uzantısını tüm etkin formatlayıcılara göre kontrol eder.
2. Dosyada uygun biçimlendirici komutunu çalıştırır.
3. Biçimlendirme değişikliklerini otomatik olarak uygular.

Bu işlem arka planda gerçekleşir ve kod stillerinizin herhangi bir manuel adım olmadan korunmasını sağlar.

---

## Yapılandırma

Biçimlendiricileri opencode yapılandırmanızdaki `formatter` bölümü aracılığıyla özelleştirebilirsiniz.

```json title="opencode.json"
{
  "$schema": "https://opencode.ai/config.json",
  "formatter": {}
}
```

Her formatlayıcı yapılandırması aşağıdakileri destekler:

| Özellik       | Tip      | Açıklama                                                               |
| ------------- | -------- | ---------------------------------------------------------------------- |
| `disabled`    | boolean  | Biçimlendiriciyi devre dışı bırakmak için bunu `true` olarak ayarlayın |
| `command`     | string[] | Biçimlendirme için çalıştırılacak komut                                |
| `environment` | object   | Biçimlendiriciyi çalıştırırken ayarlanacak ortam değişkenleri          |
| `extensions`  | string[] | Bu formatlayıcının işlemesi gereken dosya uzantıları                   |

Bazı örneklere bakalım.

---

### Biçimlendiricileri devre dışı bırakma

**tüm** biçimlendiricileri genel olarak devre dışı bırakmak için `formatter` değerini `false` olarak ayarlayın:

```json title="opencode.json" {3}
{
  "$schema": "https://opencode.ai/config.json",
  "formatter": false
}
```

**Belirli** bir biçimlendiriciyi devre dışı bırakmak için `disabled` değerini `true` olarak ayarlayın:

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

### Özel biçimlendiriciler

Komutu, ortam değişkenlerini ve dosya uzantılarını belirterek yerleşik biçimlendiricileri geçersiz kılabilir veya yenilerini ekleyebilirsiniz:

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

Komuttaki **`$FILE` yer tutucusu**, biçimlendirilen dosyanın yolu ile değiştirilecektir.
