import { describe, expect, test } from "bun:test"
import { Resvg } from "@resvg/resvg-js"
import { shellIcons } from "@opencode/ui/icons/shell"
import { getProjectAvatarSource } from "@opencode/app/project-avatar-source"
import { trayActionSvg, trayAppSvg, trayMenuIconSvg, traySessionSvg, trayStartupPixels } from "./tray-icon-art"
import { traySessionNotification, type TraySession } from "./tray-sessions"

const session: TraySession = {
  id: "session",
  directory: "/code/project",
  status: "idle",
  cost: 0,
  project: { id: "project", name: "Dashboard", icon: { color: "blue" } },
}

function render(svg: string) {
  return new Resvg(svg, { fitTo: { mode: "width", value: 36 }, font: { loadSystemFonts: false } }).render()
}

describe("tray icon artwork", () => {
  test("renders the desktop's resolved avatar colors instead of the fallback palette", () => {
    const avatar = {
      name: "Workspace",
      background: "#123456",
      border: "#654321",
      foreground: "#fefefe",
      highlight: "#ffffff29",
      accent: "#ff8800",
    }
    const artwork = traySessionSvg({ ...session, avatar, status: "permission" }, "black")
    expect(artwork).toContain('fill="#123456"')
    expect(artwork).toContain('stroke="#654321"')
    expect(artwork).toContain('fill="#fefefe"')
    expect(artwork).toContain('fill="#ff8800"')
    expect(artwork).toContain("linearGradient")
    expect(artwork).not.toContain('fill="#3250df"')
    const image = render(artwork)
    expect([...image.pixels.subarray((6 * 36 + 30) * 4, (6 * 36 + 30) * 4 + 4)]).toEqual([255, 136, 0, 255])
  })
  test("top-aligns session artwork using bottom padding without moving or resizing its pixels", () => {
    const artwork = traySessionSvg({ ...session, status: "question" }, "black")
    const options = { fitTo: { mode: "zoom" as const, value: 2 }, font: { loadSystemFonts: false } }
    const normal = new Resvg(trayMenuIconSvg(artwork), options).render()
    const twoLines = new Resvg(trayMenuIconSvg(artwork, true), options).render()
    expect([twoLines.width, twoLines.height]).toEqual([44, 60])
    expect(twoLines.pixels.subarray(0, normal.pixels.length)).toEqual(normal.pixels)
    expect(twoLines.pixels.subarray(normal.pixels.length).every((value) => value === 0)).toBe(true)
  })
  test("centers the Quit artwork on the same axis as the other action icons", () => {
    const image = new Resvg(trayActionSvg("quit", "black"), {
      fitTo: { mode: "zoom", value: 8 },
      font: { loadSystemFonts: false },
    }).render()
    const columns = Array.from({ length: image.width * image.height }, (_, index) => index)
      .filter((index) => image.pixels[index * 4 + 3] > 128)
      .map((index) => index % image.width)
    expect((Math.min(...columns) + Math.max(...columns) + 1) / 2).toBe(image.width / 2)
  })
  test("adds a four-point icon-to-label gutter without shrinking the artwork", () => {
    const artwork = trayActionSvg("settings", "black")
    const image = new Resvg(trayMenuIconSvg(artwork), {
      fitTo: { mode: "zoom", value: 2 },
      font: { loadSystemFonts: false },
    }).render()
    const original = render(artwork)
    expect([image.width, image.height]).toEqual([44, 36])
    Array.from({ length: 36 }, (_, y) => y).forEach((y) => {
      expect(image.pixels.subarray(y * 44 * 4, (y * 44 + 36) * 4)).toEqual(
        original.pixels.subarray(y * 36 * 4, (y + 1) * 36 * 4),
      )
      expect(image.pixels.subarray((y * 44 + 36) * 4, (y + 1) * 44 * 4).every((value) => value === 0)).toBe(true)
    })
  })
  test("reserves the same icon width for the detail line without drawing an icon", () => {
    const image = new Resvg(trayMenuIconSvg(""), { fitTo: { mode: "zoom", value: 2 } }).render()
    expect([image.width, image.height]).toEqual([44, 36])
    expect(image.pixels.every((value) => value === 0)).toBe(true)
  })
  test("the immediate startup bitmap matches the fully initialized mark", () => {
    expect(trayStartupPixels()).toEqual(render(trayAppSvg(false, "black")).pixels)
    expect(trayStartupPixels(255)).toEqual(render(trayAppSvg(false, "white")).pixels)
  })
  test("reuses the app's exact new-session and settings SVG paths", () => {
    expect(trayActionSvg("newAgent", "black")).toContain(shellIcons.edit.body)
    expect(trayActionSvg("settings", "black")).toContain(shellIcons["settings-gear"].body)
    for (const action of ["newAgent", "settings", "docs", "quit", "more"] as const) {
      const image = render(trayActionSvg(action, "black"))
      expect([image.width, image.height]).toEqual([36, 36])
      expect(image.pixels.some((value, index) => index % 4 === 3 && value > 0)).toBe(true)
    }
  })

  test("puts the attention dot on the app mark and clears it when attention ends", () => {
    const normal = render(trayAppSvg(false, "black"))
    const attention = render(trayAppSvg(true, "black"))
    const offset = (6 * 36 + 30) * 4
    expect([...attention.pixels.subarray(offset, offset + 4)]).toEqual([59, 92, 246, 255])
    expect(normal.pixels[offset + 3]).toBe(0)
    expect(trayAppSvg(false, "white")).not.toContain("#3b5cf6")
    expect(trayAppSvg(true, "white")).toContain('fill="white"')
  })

  test("uses project artwork for idle and attention states, a simple dot while running", () => {
    const favicon = `data:image/png;base64,${render(trayActionSvg("docs", "red")).asPng().toString("base64")}`
    expect(traySessionSvg(session, "black", favicon)).toContain(favicon)
    expect(traySessionSvg(session, "black", favicon)).not.toContain("#3b5cf6")
    for (const status of ["question", "permission"] as const) {
      const svg = traySessionSvg({ ...session, status }, "black", favicon)
      expect(svg).toContain(favicon)
      expect(svg).toContain("#3b5cf6")
      expect(svg).not.toContain('<circle cx="9" cy="9" r="3"')
    }
    const busy = traySessionSvg({ ...session, status: "working" }, "black", favicon)
    expect(busy).toContain('<circle cx="9" cy="9" r="3" fill="black"/>')
    expect(busy).not.toContain(favicon)
    expect(busy).not.toContain("#3b5cf6")
    expect(render(busy).pixels.some((value, index) => index % 4 === 3 && value > 0)).toBe(true)
  })

  test("restores the favicon with a blue corner dot for an unviewed completion", () => {
    const favicon = `data:image/png;base64,${render(trayActionSvg("docs", "red")).asPng().toString("base64")}`
    const finished = { ...session, unread: true }
    const artwork = traySessionSvg(finished, "black", favicon)
    expect(artwork).toContain(favicon)
    const image = render(artwork)
    expect([...image.pixels.subarray((6 * 36 + 30) * 4, (6 * 36 + 30) * 4 + 4)]).toEqual([59, 92, 246, 255])
    expect(traySessionNotification(finished)).toBe(true)
    expect(traySessionNotification({ ...finished, unread: false })).toBe(false)
    expect(traySessionNotification({ ...finished, status: "working" })).toBe(false)
    expect(traySessionSvg({ ...finished, unread: false }, "black", favicon)).not.toContain("#3b5cf6")
  })

  test("keeps project overrides, color-only avatars, and the OpenCode favicon consistent with the app", () => {
    expect(getProjectAvatarSource("project", { url: "icon.png", override: "custom.png" })).toBe("custom.png")
    expect(getProjectAvatarSource("project", { url: "icon.png", color: "blue" })).toBeUndefined()
    expect(getProjectAvatarSource("4b0ea68d7af9a6031a7ffda7ad66e0cb83315750")).toBe("https://opencode.ai/favicon.svg")
    expect(traySessionSvg(session, "black")).toContain('fill="#3250df"')
    expect(traySessionSvg({ ...session, project: { id: "project", name: "<example>" } }, "black")).toContain("&lt;")
    expect(traySessionSvg({ ...session, project: { id: "project", name: "مشروع" } }, "black")).toContain("م")
  })
})
