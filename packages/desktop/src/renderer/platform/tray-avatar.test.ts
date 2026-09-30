import { expect, test } from "bun:test"
import { trayAvatar } from "./tray-avatar"

test("uses resolved desktop colors and preserves a workspace-specific favicon", () => {
  const values: Record<string, string> = {
    "--v2-avatar-bg-blue": " #263fa9ff ",
    "--v2-avatar-border-blue": "#7698fdff",
    "--v2-avatar-fg": "#ffffffff",
    "--v2-alpha-light-16": "rgba(255, 255, 255, 0.16)",
    "--v2-background-bg-accent": "#3b5cf6ff",
  }
  expect(
    trayAvatar(
      { name: "Workspace", source: "data:image/png;base64,workspace", variant: "blue" },
      {
        getPropertyValue: (name) => values[name] ?? "",
      },
    ),
  ).toEqual({
    name: "Workspace",
    source: "data:image/png;base64,workspace",
    background: "#263fa9ff",
    border: "#7698fdff",
    foreground: "#ffffffff",
    highlight: "rgba(255, 255, 255, 0.16)",
    accent: "#3b5cf6ff",
  })
})

test("waits for theme styles rather than publishing an empty palette", () => {
  expect(trayAvatar({ name: "Project", variant: "blue" }, { getPropertyValue: () => "" })).toBeUndefined()
})
