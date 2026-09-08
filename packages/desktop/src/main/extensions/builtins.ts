import type { MainPlugin } from "@opencode/plugin/desktop/main"
import BrowserExtension from "@opencode/plugin-browser-desktop/main"

export const mainExtensions: readonly MainPlugin.Entry[] = [BrowserExtension]
