import { expect, test } from "bun:test"
import { isCollidingDevShortcut, resolveIdentity } from "./identity"

test.each([
  {
    channel: "dev",
    packaged: true,
    appName: "OpenCode Dev",
    appID: "ai.opencode.desktop.dev",
    appUserModelID: "ai.opencode.desktop.dev",
  },
  {
    channel: "beta",
    packaged: true,
    appName: "OpenCode Beta",
    appID: "ai.opencode.desktop.beta",
    appUserModelID: "ai.opencode.desktop.beta",
  },
  {
    channel: "prod",
    packaged: true,
    appName: "OpenCode",
    appID: "ai.opencode.desktop",
    appUserModelID: "ai.opencode.desktop",
  },
  {
    channel: "local",
    packaged: false,
    appName: "OpenCode Dev",
    appID: "ai.opencode.desktop.dev",
    appUserModelID: "ai.opencode.desktop.local",
  },
  {
    channel: "dev",
    packaged: false,
    appName: "OpenCode Dev",
    appID: "ai.opencode.desktop.dev",
    appUserModelID: "ai.opencode.desktop.local",
  },
] as const)(
  "identity for $channel (packaged=$packaged) isolates unpackaged AUMID from installed channels",
  ({ channel, packaged, appName, appID, appUserModelID }) => {
    expect(resolveIdentity(channel, packaged)).toEqual({ appName, appID, appUserModelID })
  },
)

const installedExe = "C:\\Users\\user\\AppData\\Local\\Programs\\ai.opencode.desktop.dev\\OpenCode Dev.exe"

const devElectron = "D:\\repo\\node_modules\\electron\\dist\\electron.exe"

test.each([
  {
    name: "unpackaged Electron.lnk claiming the installed dev AUMID",
    shortcut: { appUserModelId: "ai.opencode.desktop.dev", target: devElectron },
    expected: true,
  },
  {
    name: "case-insensitive AUMID match",
    shortcut: { appUserModelId: "AI.OpenCode.Desktop.Dev", target: devElectron },
    expected: true,
  },
  {
    name: "unpackaged Electron.lnk with the isolated local AUMID",
    shortcut: { appUserModelId: "ai.opencode.desktop.local", target: devElectron },
    expected: false,
  },
  {
    name: "unrelated app shortcut",
    shortcut: { appUserModelId: "com.example.other", target: devElectron },
    expected: false,
  },
  {
    name: "shortcut without an AUMID",
    shortcut: { target: devElectron },
    expected: false,
  },
  {
    name: "shortcut targeting the installed executable itself",
    shortcut: { appUserModelId: "ai.opencode.desktop.dev", target: installedExe.toLowerCase() },
    expected: false,
  },
])("isCollidingDevShortcut returns $expected for $name", ({ shortcut, expected }) => {
  expect(isCollidingDevShortcut(shortcut, "ai.opencode.desktop.dev", installedExe)).toBe(expected)
})
