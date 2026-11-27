const base = (tag: string) => tag.split("-")[0].toLowerCase()

// One dictionary per system language, matched exactly or by base language (de-AT -> de). Chromium
// lists aliases such as de and de-DE separately, so a later tag for the same language is skipped.
// US English is added when none of them is English, because prompts mix prose with English code terms.
export function defaultSpellcheckLanguages(available: readonly string[], preferred: readonly string[]) {
  const find = (tag: string) => available.find((language) => language.toLowerCase() === tag.toLowerCase())

  const languages = preferred
    .flatMap((tag) => find(tag) ?? find(base(tag)) ?? [])
    .filter((language, index, all) => all.findIndex((other) => base(other) === base(language)) === index)

  if (languages.some((language) => base(language) === "en") || !available.includes("en-US")) return languages

  return [...languages, "en-US"]
}
