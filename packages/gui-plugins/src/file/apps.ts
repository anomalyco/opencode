import { Schema } from "effect"

const OPEN_APPS = [
  "vscode",
  "cursor",
  "zed",
  "textmate",
  "antigravity",
  "finder",
  "terminal",
  "iterm2",
  "ghostty",
  "warp",
  "xcode",
  "android-studio",
  "powershell",
  "sublime-text",
] as const

export type OpenApp = (typeof OPEN_APPS)[number]

export const OpenAppPreferences = Schema.Struct({
  app: Schema.Literals(OPEN_APPS),
})
