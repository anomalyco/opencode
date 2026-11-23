# DLG35: fuzzy search with accents in a word of several

**TypeScript.** `fuzzysort` folds accents out of targets and searches (`remove_accents`), but for each word of a
search with spaces it keeps `searches[i].toLowerCase()` for the substring check, without folding. A word with an
accent is then never found as a substring of a folded target: `ström a` gets no substring bonus on `Ångström`, so
it ranks lower than its letters do.

**Rust.** `fuzzy` folds each word before every check, as fuzzysort does for a single-word search, so `ström a`
scores `Ångström` as `strom a` does. Searches without accents, and single words, rank as in TypeScript.

**Reason.** The TypeScript behavior is a fuzzysort defect; folding both sides is what its accent handling intends.
