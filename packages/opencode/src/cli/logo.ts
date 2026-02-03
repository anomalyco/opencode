import path from "path"
import { Config } from "../config/config"
import { AppRuntime } from "../effect/app-runtime"

export namespace Logo {
  // Default OpenCode logo glyphs
  // Special characters: _ = bg fill, ^ = fg on bg half block, ~ = shadow half block
  export const glyphs = {
    left: ["                   ", "█▀▀█ █▀▀█ █▀▀█ █▀▀▄", "█__█ █__█ █^^^ █__█", "▀▀▀▀ █▀▀▀ ▀▀▀▀ ▀~~▀"],
    right: ["             ▄     ", "█▀▀▀ █▀▀█ █▀▀█ █▀▀█", "█___ █__█ █__█ █^^^", "▀▀▀▀ ▀▀▀▀ ▀▀▀▀ ▀▀▀▀"],
  }

  export const marks = "_^~,"

  export type Custom = string | false | undefined

  /**
   * Load a custom logo from the configured path.
   * Returns the logo content as a string, or undefined to use default, or false to disable.
   * Gracefully falls back to global config if instance context is not available.
   */
  type LogoConfig = { logo?: string | false }

  function parseInlineConfig(): LogoConfig {
    const inline = process.env.OPENCODE_CONFIG_CONTENT
    if (!inline) return {}
    return JSON.parse(inline) as LogoConfig
  }

  export async function load(): Promise<Custom> {
    // Try full config first, fall back to global config, then inline config env var
    const config: LogoConfig = await AppRuntime.runPromise(Config.Service.use((cfg) => cfg.get()))
      .catch(() => AppRuntime.runPromise(Config.Service.use((cfg) => cfg.getGlobal())))
      .catch(() => parseInlineConfig())
      .catch(() => ({}))
    if (config.logo === false) return false
    if (!config.logo) return undefined

    const logoPath = config.logo.startsWith("~")
      ? path.join(process.env.HOME || "", config.logo.slice(1))
      : path.isAbsolute(config.logo)
        ? config.logo
        : path.resolve(config.logo)

    return Bun.file(logoPath)
      .text()
      .then((content) => content.trimEnd())
      .catch(() => undefined)
  }
}

// Legacy export for backwards compatibility
export const logo = Logo.glyphs

export const go = {
  left: ["    ", "█▀▀▀", "█_^█", "▀▀▀▀"],
  right: ["    ", "█▀▀█", "█__█", "▀▀▀▀"],
}

export const marks = "_^~,"
