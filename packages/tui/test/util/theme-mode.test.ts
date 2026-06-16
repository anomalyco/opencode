import { expect, test } from "bun:test"
import { resolveInitialThemeMode, shouldSkipInitialThemeModeProbe } from "../../src/util/theme-mode"

function createRenderer(mode: "dark" | "light" | null) {
  const timeouts: number[] = []
  const renderer = {
    waitForThemeMode(timeout: number) {
      timeouts.push(timeout)
      return Promise.resolve(mode)
    },
  }
  return { renderer, timeouts }
}

test("skips the blocking initial theme probe inside multiplexers", async () => {
  const setup = createRenderer("light")

  expect(shouldSkipInitialThemeModeProbe({ TMUX: "/tmp/tmux-501/default,123,0", TERM: "xterm-256color" })).toBe(true)
  expect(shouldSkipInitialThemeModeProbe({ STY: "123.screen", TERM: "screen-256color" })).toBe(true)
  expect(shouldSkipInitialThemeModeProbe({ TERM: "tmux-256color" })).toBe(true)
  expect(await resolveInitialThemeMode(setup.renderer, { TMUX: "/tmp/tmux-501/default,123,0" })).toBe("dark")
  expect(setup.timeouts).toEqual([])
})

test("waits for the initial theme mode on direct terminal sessions", async () => {
  const setup = createRenderer("light")

  expect(shouldSkipInitialThemeModeProbe({ TERM: "xterm-256color" })).toBe(false)
  expect(await resolveInitialThemeMode(setup.renderer, { TERM: "xterm-256color" })).toBe("light")
  expect(setup.timeouts).toEqual([1000])
})

test("falls back to dark when the direct terminal probe times out", async () => {
  const setup = createRenderer(null)

  expect(await resolveInitialThemeMode(setup.renderer, { TERM: "xterm-256color" })).toBe("dark")
  expect(setup.timeouts).toEqual([1000])
})
