import { expect, test } from "bun:test"
import { deepLinkArguments, protocolClient, registersProtocol } from "./registration"

test.each([
  [true, undefined, true],
  [true, "0", true],
  [false, undefined, false],
  [false, "0", false],
  [false, "1", true],
])("packaged %s with OPENCODE_DESKTOP_REGISTER_PROTOCOL=%s registers opencode:// %s", (packaged, value, expected) => {
  expect(registersProtocol({ packaged }, value)).toBe(expected)
})

const electron = "C:\\checkout\\node_modules\\electron\\dist\\electron.exe"

const checkout = "C:\\checkout\\packages\\desktop"

// Windows starts exactly the registered command, so a source build's must name the app's folder after the Electron
// binary. A packaged app is its own executable, and macOS and Linux do not register a command at all.
test.each([
  { packaged: true, platform: "win32" as const, expected: ["opencode"] },
  { packaged: false, platform: "win32" as const, expected: ["opencode", electron, [checkout]] },
  { packaged: false, platform: "darwin" as const, expected: ["opencode"] },
  { packaged: false, platform: "linux" as const, expected: ["opencode"] },
])("packaged $packaged on $platform registers $expected", (input) => {
  expect(protocolClient({ ...input, execPath: electron, appPath: checkout })).toEqual(input.expected)
})

test("a link reaches a running source build past the app folder its registered command adds", () => {
  const link = "opencode://console/authorized?window=window-a"

  expect(deepLinkArguments([electron, "--allow-file-access-from-files", checkout, link])).toEqual([link])
  expect(deepLinkArguments([electron, checkout])).toEqual([])
})
