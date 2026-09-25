import { expect, test } from "bun:test"
import { PlatformError } from "effect"
import { isPermissionDenied } from "../../core/src/location-services"

// Reproduces the error macOS returns when privacy settings block a folder.
const macPrivacyDenied = () =>
  PlatformError.systemError({
    _tag: "Unknown",
    module: "FileSystem",
    method: "realPath",
    pathOrDescriptor: "/Users/example/Documents",
    cause: Object.assign(new Error("EPERM: operation not permitted, lstat '/Users/example/Documents'"), {
      code: "EPERM",
    }),
  })

test("recognizes the macOS privacy denial reported as Unknown with an EPERM cause", () => {
  expect(isPermissionDenied(macPrivacyDenied())).toBe(true)
  expect(
    isPermissionDenied(
      PlatformError.systemError({ _tag: "PermissionDenied", module: "FileSystem", method: "realPath" }),
    ),
  ).toBe(true)
})

test("does not treat other filesystem failures as permission denied", () => {
  expect(
    isPermissionDenied(PlatformError.systemError({ _tag: "NotFound", module: "FileSystem", method: "realPath" })),
  ).toBe(false)
  expect(
    isPermissionDenied(
      PlatformError.systemError({
        _tag: "Unknown",
        module: "FileSystem",
        method: "realPath",
        cause: Object.assign(new Error("EIO: i/o error"), { code: "EIO" }),
      }),
    ),
  ).toBe(false)
})
