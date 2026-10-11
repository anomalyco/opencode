import { describe, expect, test } from "bun:test"
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
      cwd: new URL("..", import.meta.url).pathname,
      env: {
        ...Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== "VITE_CONSOLE_MARKETING_ENABLED")),
        ...(value === undefined ? {} : { VITE_CONSOLE_MARKETING_ENABLED: value }),
      },
    })

    expect(result.exitCode).toBe(0)
    expect(result.stdout.toString().trim()).toBe(String(enabled))
  })

  test.each([...LOCALES])("provides navigation labels through the English fallback for %s", (locale) => {
    expect(i18n(locale)["nav.models"]).toBe("Models")
    expect(i18n(locale)["nav.teams"]).toBe("Teams")
  })
})
