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
- For developer-facing terminology, use the words already recognized by the target language's developer community instead of literal dictionary translations. Check at least two maintained localized developer corpora among Firefox, KDE, and VS Code when they are available; use Microsoft or official language authorities as supporting evidence.
- Translate complete phrases in their product context. Check recurring concepts such as session, prompt, agent, model, provider, fork, shell, terminal, workspace, worktree, context, permission, tool, and server for consistent, grammatical usage. Keep an established English borrowing when the developer corpora do.
- If maintained target-language corpora are sparse or disagree, choose conservative wording and identify the uncertain terms in the final response instead of inventing terminology.
- Apply the locale glossary included in the request.
- `ui.sessionTurn.diffs.changed.one` and `ui.sessionTurn.diffs.changed.other` are complete count phrases. Preserve `{{count}}` and translate the whole phrase naturally rather than composing translated fragments.
- Use only read, glob, grep, webfetch, websearch, and edit tools. Do not run commands or delegate work.
- Finish only when every requested key is synchronized and no other file has changed.
