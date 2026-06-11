import { expect, test } from "bun:test"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { discoverDesktopThemes } from "@/theme/desktop"
import { tmpdir } from "../fixture/fixture"

function theme(id: string, primary: string) {
  return {
    $schema: "https://opencode.ai/desktop-theme.json",
    id,
    name: id,
    light: {
      palette: {
        neutral: "#ffffff",
        ink: "#111111",
        primary,
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
        primary,
        success: "#00aa00",
        warning: "#aaaa00",
        error: "#aa0000",
        info: "#0000aa",
      },
    },
  }
}

test("discovers desktop themes with later directories overriding earlier ones", async () => {
  await using tmp = await tmpdir()
  const global = path.join(tmp.path, "global")
  const project = path.join(tmp.path, "project")
  await mkdir(path.join(global, "desktop-themes"), { recursive: true })
  await mkdir(path.join(project, "desktop-themes"), { recursive: true })
  await writeFile(path.join(global, "desktop-themes", "custom.json"), JSON.stringify(theme("custom", "#111111")))
  await writeFile(path.join(project, "desktop-themes", "custom.json"), JSON.stringify(theme("custom", "#222222")))

  await expect(discoverDesktopThemes([global, project])).resolves.toMatchObject([
    {
      id: "custom",
      light: { palette: { primary: "#222222" } },
    },
  ])
})

test("ignores invalid desktop theme files", async () => {
  await using tmp = await tmpdir()
  await mkdir(path.join(tmp.path, "desktop-themes"), { recursive: true })
  await writeFile(path.join(tmp.path, "desktop-themes", "broken.json"), "{")
  await writeFile(path.join(tmp.path, "desktop-themes", "invalid.json"), JSON.stringify({ id: "bad", theme: {} }))

  await expect(discoverDesktopThemes([tmp.path])).resolves.toEqual([])
})
