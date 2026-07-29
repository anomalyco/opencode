# he Glossary

## Sources

- Hebrew i18n skill guidance

## Do Not Translate (Locale Additions)

- `OpenCode` (preserve casing in prose; keep `opencode` only in commands, package names, paths, or code)
- `OpenCode CLI`
- `CLI`, `TUI`, `MCP`, `OAuth`
- Commands, flags, file paths, and code literals (keep exactly as written)

## Preferred Terms

No PR-backed term mappings yet. Add entries here when review PRs introduce repeated wording corrections.

## Guidance

- Prefer natural Hebrew phrasing over literal translation
- Keep tone clear and direct in UI labels and docs prose
- Preserve technical artifacts exactly: commands, flags, code, URLs, model IDs, and file paths
- For RTL text, treat code, commands, and paths as LTR artifacts and keep their character order unchanged
- Use CSS logical properties (margin-inline, padding-inline) for RTL-aware layouts
- For numbers, phone numbers, and currency, use `dir="ltr"` spans or `<bdi>` elements

## Plural Forms

Hebrew requires three plural forms (per Unicode CLDR):
- `one` - singular (1)
- `two` - dual (2)
- `other` - plural (0, 3+)

Example ICU MessageFormat pattern:
```
{count, plural,
  one {פריט אחד}
  two {שני פריטים}
  other {{count} פריטים}
}
```

## Date and Time Formatting

Use `Intl.DateTimeFormat('he-IL')` for Israeli date format (day before month):
```javascript
new Intl.DateTimeFormat('he-IL', {
  year: 'numeric',
  month: 'long', 
  day: 'numeric',
})
// Output: "4 במרץ 2026"
```

## RTL Considerations

- Set `dir="rtl"` on the html element for Hebrew locale
- Use CSS logical properties instead of physical properties (e.g., `margin-inline-start` instead of `margin-left`)
- For mixed LTR/RTL content, use `dir="ltr"` spans or `<bdi>` elements
- Text alignment should use `text-align: start` instead of `text-align: left`

## Avoid

- Avoid translating product and protocol names that are fixed identifiers
- Avoid mixing multiple Hebrew terms for the same recurring UI action once a preferred term is established
- Avoid forcing LTR layout on Hebrew content without proper direction handling