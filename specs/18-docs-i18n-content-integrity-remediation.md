# Docs i18n Content Integrity Remediation

## Objective

Repair remaining localized docs content defects so non-root locale pages are publish-safe, syntax-valid, and readable.

## Primary targets

- `packages/web/src/content/docs/ja/**/*.mdx`
- `packages/web/src/content/docs/zh-cn/**/*.mdx`
- `packages/web/src/content/docs/ru/**/*.mdx`
- `packages/web/src/content/docs/de/**/*.mdx`
- `packages/web/src/content/docs/tr/**/*.mdx`
- `packages/web/src/content/docs/da/**/*.mdx`
- Any additional non-root locale files with the same defect classes

## Defect classes in scope

1. Full-width admonition openers:
   - `：：：tip`, `：：：note`, localized equivalents.
2. Placeholder artifacts:
   - Tokens like `___W0___`, `___T1___`, or similar unresolved placeholders.
3. Malformed markdown links:
   - Unbalanced or extra closing bracket artifacts (for example `...)]`).
4. Residual untranslated prose in localized docs:
   - Human-facing narrative text that should be localized.

Not in scope:

- Translating command literals, model/provider identifiers, product names, or code samples that are intentionally literal.

## Implementation plan

1. Build a deterministic defect inventory.
   - Start from regex-driven candidate lists for each defect class.
   - Review candidates in-context to avoid false positives.
2. Remediate by defect class.
   - Convert full-width admonition openers to valid Starlight admonition syntax (`:::`).
   - Replace placeholder artifacts with intended localized text/URLs.
   - Fix malformed links while preserving targets, anchors, and query strings.
3. Clean residual untranslated prose.
   - Prioritize known index-page issues in `de`, `tr`, and `da`.
   - Sweep additional locales only where clear untranslated narrative text remains.
4. Protect source-of-truth content.
   - Do not modify root English files under `packages/web/src/content/docs/*.mdx`.
5. Validate and hand off.
   - Re-run content scans and docs checks to confirm no known defects remain.

## Dependencies

- No upstream blocker.
- Should complete before spec 20 tightens guardrails and fail conditions.

## Acceptance criteria

- No `：：：` markers remain in non-root locale docs.
- No unresolved placeholder artifacts remain in non-root locale docs.
- No malformed markdown link artifacts remain in touched locale files.
- Known residual untranslated index prose issues are remediated.
- `bun run --cwd=packages/web i18n:check` remains green after remediation.

## Validation commands

```bash
rg -n '：：：' packages/web/src/content/docs/*/*.mdx
rg -n '___[A-Z0-9_]+___' packages/web/src/content/docs/*/*.mdx
rg -n '\)\]' packages/web/src/content/docs/*/*.mdx
rg -n 'A modern terminal emulator like:|\[Learn more\]\(\./providers#directory\)|\[example conversation\]' packages/web/src/content/docs/*/*.mdx
bun run --cwd=packages/web i18n:check
bun --cwd packages/web build
```
