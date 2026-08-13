import { Permission } from "@opencode-ai/core/permission"
import { Effect, Layer } from "effect"

export const permissionLayer = (overrides: Partial<Permission.Interface> = {}) =>
  Layer.mock(Permission.Service, {
    allowsAll: () => Effect.succeed(false),
    ...overrides,
  })
