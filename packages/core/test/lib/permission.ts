import { Permission } from "@opencode/core/permission"
import { FileAccess } from "@opencode/core/file-access"
import { Effect, Layer } from "effect"

export const permissionLayer = (overrides: Partial<Permission.Interface> = {}) =>
  Layer.mock(Permission.Service, { close: Effect.void, ...overrides })

export const fileAccessUnavailable = Layer.mock(FileAccess.Service, {
  authorizeRead: () => Effect.die("File access is unavailable in this test"),
})
