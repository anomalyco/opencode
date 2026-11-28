import { describe, expect, test } from "bun:test"
// Every language, as the Worker registers them at startup.
import "../src/i18n/server"
import path from "node:path"
import { i18n } from "../src/i18n"
import { LOCALES } from "../src/lib/language"

describe("Console marketing navigation gate", () => {
  test.each([
    ["missing", undefined, false],
    ["false", "false", false],
    ["invalid", "1", false],
    ["true", "true", true],
  ] as const)("handles the %s flag", (_name, value, enabled) => {
    const result = Bun.spawnSync({
      cmd: [
        process.execPath,
        "--eval",
        'import { config } from "./src/config.ts"; console.log(config.consoleMarketingEnabled)',
      ],
      cwd: path.join(import.meta.dir, ".."),
      env: {
        ...Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== "VITE_CONSOLE_MARKETING_ENABLED")),
        ...(value === undefined ? {} : { VITE_CONSOLE_MARKETING_ENABLED: value }),
      },
    })

    expect(result.exitCode).toBe(0)
    expect(result.stdout.toString().trim()).toBe(String(enabled))
  })

  test.each([...LOCALES])("provides the current navigation labels for %s", (locale) => {
    expect(i18n(locale)["site.nav.models"]).not.toBeEmpty()
    expect(i18n(locale)["site.nav.subscriptions"]).not.toBeEmpty()
  })
})
