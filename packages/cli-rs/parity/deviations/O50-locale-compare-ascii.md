# O50: `localeCompare` beyond printable ASCII

**TypeScript.** Names sort with `a.localeCompare(b)`, which Bun answers from ICU's root collation. ICU sorts an
accented letter with its base letter (`é` with `e`, before `f`), gives each other script its own place among
the letters, puts tabs and newlines first with the other white space, and ignores DEL and most control characters.

**Rust.** `opencode_api_types::js::locale_compare` follows ICU for printable ASCII: punctuation and symbols in ICU's
order, then digits, then letters without regard to case, lowercase first on a tie. Every other character sorts after
the letters by code point, so `é` comes after `z`, and a tab or DEL after every letter.

It shows in the order of theme, model, provider, agent and plugin names that hold such characters. ASCII names sort
as in TypeScript.

**Reason.** Decision O-50 (D6): one small port instead of ICU's collation tables. Matching ICU would take its root
collation data (a crate such as `icu_collator`, with its data), or an approximation that folds Latin accents into a
primary key with the table `script/gen/accents.ts` writes for `fuzzy`, and orders control characters as ICU does.
