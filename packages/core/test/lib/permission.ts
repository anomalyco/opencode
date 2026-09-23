import { Permission } from "@opencode/core/permission"
import { Effect, Layer } from "effect"

export const permissionLayer = (overrides: Partial<Permission.Interface> = {}) =>
  Layer.mock(Permission.Service, { close: Effect.void, ...overrides })
