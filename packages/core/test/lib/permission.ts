import { Permission } from "@opencode-ai/core/permission"
import { Layer } from "effect"

export const permissionLayer = (overrides: Partial<Permission.Interface> = {}) =>
  Layer.mock(Permission.Service, overrides)
