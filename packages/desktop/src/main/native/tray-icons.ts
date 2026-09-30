import { nativeImage, nativeTheme } from "electron"
import type { NativeImage } from "electron"
import { getProjectAvatarSource } from "@opencode/app/project-avatar-source"
import { trayActionSvg, trayAppSvg, trayMenuIconSvg, traySessionSvg, type TrayActionIcon } from "./tray-icon-art"
import type { TraySession } from "./tray-sessions"

export type TrayIcons = Awaited<ReturnType<typeof createTrayIcons>>

export async function createTrayIcons() {
  const { Resvg } = await import("@resvg/resvg-js")
  const images = new Map<string, string>()
  const cache = new Map<string, NativeImage>()
  const foreground = () => (nativeTheme.shouldUseDarkColors ? "#ffffff" : "#202020")
  const render = (svg: string, template: boolean, text = false) => {
    const key = `${template}:${svg}`
    const existing = cache.get(key)
    if (existing) return existing
    const png = new Resvg(svg, { fitTo: { mode: "zoom", value: 2 }, font: { loadSystemFonts: text } }).render().asPng()
    const image = nativeImage.createFromBuffer(png, { scaleFactor: 2 })
    image.setTemplateImage(process.platform === "darwin" && template)
    if (cache.size >= 128) cache.clear()
    cache.set(key, image)
    return image
  }
  return {
    app: (attention: boolean) => render(trayAppSvg(attention, foreground()), !attention),
    action: (action: TrayActionIcon) => render(trayMenuIconSvg(trayActionSvg(action, foreground())), true),
    spacer: () => render(trayMenuIconSvg(""), false),
    session: (session: TraySession, twoLines = false) => {
      const image = images.get(source(session) ?? "")
      return render(
        trayMenuIconSvg(traySessionSvg(session, foreground(), image), twoLines),
        session.status === "working",
        !image && session.status !== "working",
      )
    },
    async prepare(sessions: TraySession[], signal: AbortSignal) {
      const sources = new Set(sessions.flatMap((session) => source(session) ?? []))
      images.forEach((_, source) => {
        if (!sources.has(source)) images.delete(source)
      })
      await Promise.all(
        [...sources]
          .filter((source) => !images.has(source))
          .map(async (source) => {
            // Project icons are images, never local file paths or authenticated API requests.
            if (!/^(https?:\/\/|data:image\/)/i.test(source)) return
            const image = await fetch(source, { signal })
              .then(async (response) => {
                if (!response.ok) return
                const data = Buffer.from(await response.arrayBuffer())
                const bitmap = nativeImage.createFromBuffer(data)
                if (!bitmap.isEmpty()) return bitmap.resize({ width: 36 }).toDataURL()
                const png = new Resvg(data, { fitTo: { mode: "width", value: 36 }, font: { loadSystemFonts: false } })
                  .render()
                  .asPng()
                return `data:image/png;base64,${png.toString("base64")}`
              })
              .catch(() => undefined)
            if (image) images.set(source, image)
          }),
      )
    },
  }

  function source(session: TraySession) {
    return session.avatar ? session.avatar.source : getProjectAvatarSource(session.project?.id, session.project?.icon)
  }
}
