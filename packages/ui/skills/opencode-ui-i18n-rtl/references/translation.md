# Translation process

Use this process when you write or review non-English strings. Feature work does not add translations; it adds English source strings only.

## Sources

- Do not translate from model knowledge alone. Verify terminology and grammar with:
  - Unicode CLDR locale and plural data.
  - Microsoft Localization Style Guides and terminology.
  - Apple localization and style guidance, and localized Apple platform UI.
  - Mozilla localization style guides and Mozilla Pontoon.
  - The Firefox localization corpus at `github.com/mozilla-l10n/firefox-l10n`.
- Also use the language authority or official dictionary for the locale, for example RAE/Fundéu, FranceTerme, Duden, TDK, Kotus/Kielitoimiston sanakirja, Språkrådet/Bokmålsordboka, Rada Języka Polskiego/PWN, the Russian and Arabic language academies, the Ukrainian Orthography, Taiwan MOE dictionaries, or the Royal Society of Thailand.
- Treat the English dictionary as the semantic source of truth.

## Developer terminology

- Prefer the words that the target language's developer community already uses over literal dictionary translations.
- Cross-check maintained localized developer products such as Firefox, KDE, and VS Code. Use at least two independent corpora when they are available.
- If established practice keeps an English loanword or acronym, keep it. Do not invent a translation.

## Phrases in context

- Translate complete UI phrases in context. A glossary hit is evidence, not permission to translate word by word.
- Check terse labels such as session, prompt, agent, model, fork, shell, terminal, workspace, and worktree in the same grammatical role before you choose a term.
- Preserve placeholders (`{{count}}`, `{{name}}`), code identifiers, product names, and keyboard labels exactly.
- Supply every plural category that CLDR defines for the locale (`zero`, `one`, `two`, `few`, `many`, `other`). `.other` is the required fallback.

## Before a locale is ready

- Audit recurring concepts for one consistent translation.
- Review every value that still equals English. Keep it only when it is a product name, provider or tool name, URL, code token, keyboard legend, acronym, asset name, or established borrowing. Translate unexplained leftovers.

## Review notes

- Name the corpora you used.
- Flag uncertain or region-specific terminology so native speakers can focus their review.
