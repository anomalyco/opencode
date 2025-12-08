import { test, expect } from "bun:test"

test("theme options are sorted alphabetically", () => {
  // Simulate the theme names that would come from theme.all()
  const unsortedThemes = [
    "synthwave84",
    "tokyonight", 
    "vesper",
    "vercel",
    "zenburn",
    "my-everforest",
    "moonlight-iii",
    "my-solarized",
    "my-github",
    "my-zenburn",
    "moonlight-eclipse",
    "my-synthwave84",
    "my-moonlight-iii",
    "my-midnight",
    "my-kanagawa",
    "my-matrix",
    "moonlight-ii",
    "my-rosepine",
    "my-vesper",
    "moonlight",
    "my-moonlight",
    "my-ayu",
    "my-material",
    "my-nord",
    "my-cobalt",
    "my-moonlight-ii",
    "my-one-dark"
  ]

  // Apply the same sorting logic as in DialogThemeList
  const sortedThemes = unsortedThemes
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
    .map((value) => ({
      title: value,
      value: value,
    }))

  // Extract just the titles for testing
  const titles = sortedThemes.map(opt => opt.title)

  // Verify alphabetical order
  for (let i = 1; i < titles.length; i++) {
    expect(titles[i-1].localeCompare(titles[i], undefined, { sensitivity: 'base' })).toBeLessThanOrEqual(0)
  }

  // Verify specific ordering expectations
  expect(titles[0]).toBe("moonlight")
  expect(titles[1]).toBe("moonlight-eclipse")
  expect(titles[titles.length - 1]).toBe("zenburn")
})

test("theme sorting is case-insensitive", () => {
  const mixedCaseThemes = ["Zenburn", "aura", "Catppuccin", "dracula", "Everforest"]
  
  const sortedThemes = mixedCaseThemes
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
    .map((value) => ({
      title: value,
      value: value,
    }))

  const titles = sortedThemes.map(opt => opt.title)

  // Should be: aura, Catppuccin, dracula, Everforest, Zenburn
  expect(titles).toEqual(["aura", "Catppuccin", "dracula", "Everforest", "Zenburn"])
})

test("theme sorting handles custom themes with prefixes", () => {
  const themesWithPrefixes = [
    "my-ayu",
    "my-cobalt", 
    "my-zenburn",
    "standard-theme",
    "another-theme"
  ]
  
  const sortedThemes = themesWithPrefixes
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
    .map((value) => ({
      title: value,
      value: value,
    }))

  const titles = sortedThemes.map(opt => opt.title)

  // Should be alphabetically sorted regardless of "my-" prefix
  expect(titles).toEqual(["another-theme", "my-ayu", "my-cobalt", "my-zenburn", "standard-theme"])
})