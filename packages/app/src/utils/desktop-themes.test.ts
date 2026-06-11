import { expect, test } from "bun:test"
import type { DesktopTheme } from "@opencode-ai/ui/theme"
import { fetchDesktopThemes } from "./desktop-themes"

function theme(id: string): DesktopTheme {
  return {
    id,
    name: id,
    light: {
      palette: {
        neutral: "#ffffff",
        ink: "#111111",
        primary: "#222222",
        success: "#00aa00",
        warning: "#aaaa00",
        error: "#aa0000",
        info: "#0000aa",
      },
    },
    dark: {
      palette: {
        neutral: "#000000",
        ink: "#eeeeee",
        primary: "#222222",
        success: "#00aa00",
        warning: "#aaaa00",
        error: "#aa0000",
        info: "#0000aa",
      },
    },
  }
}

function fetcher(calls: Request[]) {
  return (async (input, init) => {
    calls.push(new Request(input, init))
    return new Response(JSON.stringify({ themes: [theme("custom")] }))
  }) as typeof fetch
}

test("fetches desktop themes from the server route", async () => {
  const calls: Request[] = []
  const result = await fetchDesktopThemes({
    server: { url: "http://localhost:4096" },
    fetch: fetcher(calls),
  })

  expect(calls[0]!.url).toBe("http://localhost:4096/theme/desktop")
  expect(result).toEqual([theme("custom")])
})

test("sends basic auth when server has credentials", async () => {
  const calls: Request[] = []
  await fetchDesktopThemes({
    server: { url: "http://localhost:4096", username: "user", password: "pass" },
    fetch: fetcher(calls),
  })

  expect(calls[0]!.headers.get("authorization")).toBe("Basic dXNlcjpwYXNz")
})
