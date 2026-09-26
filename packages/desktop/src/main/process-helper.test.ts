import { expect, test } from "bun:test"
import { processWin32HelperPath } from "./process-helper"

test("resolves the packaged Windows process helper beside Electron resources", () => {
  expect(
    processWin32HelperPath({
      appIsPackaged: true,
      resourcesPath: "/app/resources",
      developmentResourcesPath: "/workspace/packages/desktop/resources",
    }),
  ).toBe("/app/resources/opencode-process-win32.exe")
})

test("resolves the development Windows process helper from Desktop resources", () => {
  expect(
    processWin32HelperPath({
      appIsPackaged: false,
      resourcesPath: "/app/resources",
      developmentResourcesPath: "/workspace/packages/desktop/resources",
    }),
  ).toBe("/workspace/packages/desktop/resources/opencode-process-win32.exe")
})
