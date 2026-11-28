import { describe, expect, test } from "bun:test"
import { siteLinks } from "~/component/site/links"
import { translator } from "~/i18n"
import { getStarted } from "~/lib/get-started"
import { homeContent } from "~/lib/home-content"
import { consoleRoute, localized, route } from "~/lib/language"

const t = translator("en")
const de = (path: string) => consoleRoute("de", path)

describe("consoleRoute", () => {
  test("prefixes the Console's marketing pages for non-English pages", () => {
    for (const path of [
      "/console",
      "/console/models",
      "/console/go",
      "/console/enterprise",
      "/console/teams",
      "/console/support",
      "/console/integrations",
    ])
      expect(consoleRoute("de", path)).toBe(`/de${path}`)
    expect(consoleRoute("ru", "/console/go#console-go-plan-go")).toBe("/ru/console/go#console-go-plan-go")
    expect(consoleRoute("de", "/de/console/models/")).toBe("/de/console/models/")
    expect(consoleRoute("de", "/console/models?sort=price")).toBe("/de/console/models?sort=price")
  })

  test("leaves English and the Console's app pages alone", () => {
    expect(consoleRoute("en", "/console/go")).toBe("/console/go")
    for (const path of [
      "/console/workspace",
      "/console/login",
      "/console/funnel/v1.js",
      "/console/sitemap.xml",
      "/auth",
    ])
      expect(consoleRoute("de", path)).toBe(path)
  })

  test("matches marketing pages exactly, not their subpaths", () => {
    expect(consoleRoute("de", "/console/models/compare")).toBe("/console/models/compare")
    expect(consoleRoute("de", "/console/integrations/slack")).toBe("/console/integrations/slack")
  })

  test("keeps the middleware redirect for prefixed Console URLs", () => {
    // localized() excludes /console, so /de/console 301s to /console until the Console serves it.
    expect(localized("/console")).toBe(false)
    expect(localized("/console/go")).toBe(false)
    expect(route("de", "/de/console")).toBe("/console")
  })
})

describe("localized Console links", () => {
  test("the sidebar and footer use the page's language for Console marketing pages", () => {
    const links = siteLinks(t, (path) => route("de", path), de)
    const nav = Object.fromEntries(links.nav.map((item) => [item.id, item.href]))
    expect(nav.console).toBe("/de/console")
    expect(nav.models).toBe("/de/console/models")
    expect(nav.subscriptions).toBe("/de/console/go")
    expect(nav.enterprise).toBe("/de/console/enterprise")
    expect(nav.docs).toBe("/de/docs")
    const anomaly = links.columns.find((column) => column.title === "Anomaly")
    expect(anomaly?.links.filter((item) => item.href.startsWith("/de/console")).map((item) => item.href)).toEqual([
      "/de/console",
      "/de/console/models",
      "/de/console/go",
      "/de/console/enterprise",
    ])
  })

  test("the home Console and Get started CTAs follow the page's language", () => {
    const content = homeContent(t, (path) => route("de", path), de)
    expect(content.console.cta.href).toBe("/de/console")
    expect(content.console.sales.href).toBe("/de/console/enterprise")
    const start = getStarted((path) => route("de", path), de)
    expect(start.links.go).toBe("/de/console/go")
    expect(start.plans.map((plan) => plan.href)).toEqual([
      "/de/console/go#console-go-plan-go",
      "/de/console/go#console-go-plan-go-plus",
    ])
  })
})
