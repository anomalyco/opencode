import { expect, test } from "bun:test"
import { navConfigRules, navFlags, navSequence } from "~/component/site/nav-config"
import { navDefaults, normalizeNavConfig } from "~/component/site/settings"

// A label renamed in Design mode is English text. The pre-paint rules swap it in for English pages
// only, so a page in another language keeps its translated label (Nov 2026: a rename froze it).
test("a renamed nav label applies to English pages only", () => {
  const navConfig = normalizeNavConfig(navDefaults, undefined).map((entry) =>
    entry.id === "docs" ? { ...entry, label: "Handbook" } : entry,
  )
  const css = navConfigRules(normalizeNavConfig, navSequence, navDefaults, navFlags, { navConfig })
  const rules = css.split("}").filter((rule) => rule.includes("label"))
  expect(rules.length).toBeGreaterThan(0)
  rules.forEach((rule) => expect(rule.startsWith('html[data-locale="en"] ')).toBe(true))
  expect(css).toContain('content:"Handbook"')
})
