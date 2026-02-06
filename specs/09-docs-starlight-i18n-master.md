# Docs Starlight i18n Master Plan

## Context and decision

- Requested path was `packages/docs`, but Astro + Starlight docs are in `packages/web`.
- `packages/docs` currently contains a Mintlify starter and is out of scope for this rollout.
- This plan implements i18n in `packages/web` and keeps current `/docs/*` URLs working.

## Goals

1. No hardcoded English UI strings in the docs site shell/components.
2. Every supported locale has every required i18n key.
3. Astro + Starlight i18n is implemented using first-party best practices.

## Non-goals

- Migrating Mintlify content in `packages/docs`.
- Changing product names, command literals, code samples, or provider/model identifiers.

## Locale mapping (from README files)

| README file     | Language              | Starlight key | `lang` tag | Dir   | Notes                                               |
| --------------- | --------------------- | ------------- | ---------- | ----- | --------------------------------------------------- |
| `README.md`     | English               | `root`        | `en`       | `ltr` | Root locale keeps existing non-prefixed docs routes |
| `README.ar.md`  | Arabic                | `ar`          | `ar`       | `rtl` | Validate RTL layout and punctuation                 |
| `README.br.md`  | Portuguese (Brazil)   | `pt-br`       | `pt-BR`    | `ltr` | README uses `br`; docs use canonical `pt-br`        |
| `README.bs.md`  | Bosnian               | `bs`          | `bs-BA`    | `ltr` | Requires custom UI translations                     |
| `README.da.md`  | Danish                | `da`          | `da-DK`    | `ltr` |                                                     |
| `README.de.md`  | German                | `de`          | `de-DE`    | `ltr` |                                                     |
| `README.es.md`  | Spanish               | `es`          | `es-ES`    | `ltr` |                                                     |
| `README.fr.md`  | French                | `fr`          | `fr-FR`    | `ltr` |                                                     |
| `README.it.md`  | Italian               | `it`          | `it-IT`    | `ltr` |                                                     |
| `README.ja.md`  | Japanese              | `ja`          | `ja-JP`    | `ltr` |                                                     |
| `README.ko.md`  | Korean                | `ko`          | `ko-KR`    | `ltr` |                                                     |
| `README.no.md`  | Norwegian             | `nb`          | `nb-NO`    | `ltr` | README uses `no`; docs use canonical `nb`           |
| `README.pl.md`  | Polish                | `pl`          | `pl-PL`    | `ltr` |                                                     |
| `README.ru.md`  | Russian               | `ru`          | `ru-RU`    | `ltr` |                                                     |
| `README.th.md`  | Thai                  | `th`          | `th-TH`    | `ltr` |                                                     |
| `README.tr.md`  | Turkish               | `tr`          | `tr-TR`    | `ltr` |                                                     |
| `README.zh.md`  | Chinese (Simplified)  | `zh-cn`       | `zh-CN`    | `ltr` | README uses `zh`; docs use canonical `zh-cn`        |
| `README.zht.md` | Chinese (Traditional) | `zh-tw`       | `zh-TW`    | `ltr` | README uses `zht`; docs use canonical `zh-tw`       |

Compatibility note:

- If short-code URL compatibility is required, add redirects from `br -> pt-br`, `no -> nb`, `zh -> zh-cn`, and `zht -> zh-tw`.

## Spec breakdown

- `specs/10-docs-starlight-i18n-foundation.md`
- `specs/11-docs-i18n-shell-astro.md`
- `specs/12-docs-i18n-share-surfaces.md`
- `specs/13-docs-i18n-content-structure.md`
- `specs/14-docs-i18n-locale-pack-west.md`
- `specs/15-docs-i18n-locale-pack-east.md`
- `specs/16-docs-i18n-guardrails-ci.md`

## Parallel execution plan

| Phase | Specs      | Parallelism                   |
| ----- | ---------- | ----------------------------- |
| A     | 10         | Sequential (foundation first) |
| B     | 11, 12, 13 | Fully parallel after 10       |
| C     | 14, 15     | Fully parallel after 11/12/13 |
| D     | 16         | Final gate after 14/15        |

Parallel agent capacity:

- Phase B: 3 agents.
- Phase C: up to 17 agents (1 per locale) using locale checklists in specs 14 and 15.

## Definition of done

- `packages/web` Starlight config has all locales configured and routable.
- All user-visible shell/component strings are translation-key based.
- Locale docs trees exist for every required language and slug.
- Key parity checks pass for all locales.
- Build and type checks pass for docs app.

## Validation commands

```bash
bun --cwd packages/web astro check
bun --cwd packages/web build
bun --cwd packages/web run i18n:check
```
