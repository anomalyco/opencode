Translate the product app locale `$1` from the English source dictionaries. English is the read-only source of truth. Its copy is intentional and must never be modified, rewritten, or "improved."

The translation request below contains the locale glossary, exact source and target files, plus missing, extra, and placeholder-mismatched keys.

```json
$ARGUMENTS
```

Requirements:

- Edit only the target files listed in the request. Never edit English, another locale, tests, registries, docs, or other packages.
- Treat every English key and value as intentional. Translate from it without changing the English source files in any way.
- Add every missing key with a natural, concise translation suitable for application UI.
- Remove keys listed as extra and repair values listed under `placeholders` so their `{{tokens}}` exactly match English.
- Preserve existing translations unless they have a listed placeholder mismatch.
- Preserve meaning, intent, tone, capitalization, punctuation, whitespace, and formatting.
- Preserve technical terms and artifacts exactly: OpenCode, API names, identifiers, code, commands, flags, paths, URLs, versions, error messages, config keys, and placeholder tokens.
- Apply the locale glossary included in the request.
- `ui.sessionTurn.diffs.changed.one` and `ui.sessionTurn.diffs.changed.other` are complete count phrases. Preserve `{{count}}` and translate the whole phrase naturally rather than composing translated fragments.
- Use only read, glob, grep, and edit tools. Do not run commands or delegate work.
- Finish only when every requested key is synchronized and no other file has changed.
