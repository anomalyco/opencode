import { afterEach, beforeEach, expect, test } from "bun:test"
import { Config } from "../../src/config/config"
import { AppRuntime } from "../../src/effect/app-runtime"
import { resolveLocale, type Locale } from "../../src/i18n"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

beforeEach(async () => {
  await AppRuntime.runPromise(Config.Service.use((svc) => svc.invalidate(true)))
})

afterEach(async () => {
  await AppRuntime.runPromise(Config.Service.use((svc) => svc.invalidate(true)))
})

test("loads locale from config and normalizes values", async () => {
  await using tmp = await tmpdir({
    config: {
      locale: "zh-CN" as never,
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await AppRuntime.runPromise(Config.Service.use((svc) => svc.get()))
      expect(config.locale).toBe("zh" satisfies Locale)
    },
  })
})

test("invalid locale defers to environment fallback instead of forcing english", async () => {
  const prev = process.env.LANG
  process.env.LANG = "zh_CN.UTF-8"
  await using tmp = await tmpdir({
    config: {
      locale: "xx-YY" as never,
      username: "testuser",
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await AppRuntime.runPromise(Config.Service.use((svc) => svc.get()))
      expect(config.locale).toBeUndefined()
      expect(resolveLocale(config.locale)).toBe("zh" satisfies Locale)
      expect(config.username).toBe("testuser")
    },
  })
  if (prev === undefined) delete process.env.LANG
  else process.env.LANG = prev
})
