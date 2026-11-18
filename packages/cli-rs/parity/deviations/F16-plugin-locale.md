# F16: the locale a plugin is told

**TypeScript.** A TS TUI plugin that wants the user's locale asks `Intl`
(`Intl.DateTimeFormat().resolvedOptions().locale`). Bun 1.4.4 answers `en-US` whatever the system says. I measured
this on Windows 11 (win-locale) with the user locale set to `da-DK`, with and without `LANG=de_DE.UTF-8`: `NumberFormat`,
`Collator`, `toLocaleString` and `toLocaleDateString` all gave `en-US`. On Linux the answer was the same, with and
without `LANG`. macOS was not measured.

**Rust.** The contract's `Info::locale` is the user's locale:

- **First,** the first of `LC_ALL`, `LC_MESSAGES` and `LANG` that names one.
- **When none does, on Windows,** the user's default locale (`GetUserDefaultLocaleName`, the regional format the user
  set, such as `da-DK`).
- **Otherwise,** `None`. macOS's system language (`CFLocaleCopyCurrent`) is not read, because that would add a Core
  Foundation binding for this one value.

**Reason.**

- **The fact names the user's locale, not Bun's default.** A native plugin picks its strings by it, and a fixed
  `en-US` would tell it nothing.
- **Terminals set the variables.** Terminal.app and iTerm2 set `LANG` from the system's language by default, so on
  macOS the fact usually carries the system's locale anyway.
- **What is left:**
  - A TS plugin and a native one can be told different locales, the TS plugin always `en-US`.
  - On macOS, a launch with no locale variable is told `None`.
- **Effect:** the host formats nothing by the locale, so the only effect is which strings a plugin chooses.
