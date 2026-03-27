import { Protected } from "@/file/protected"
import { SandboxPolicy } from "./policy"

export namespace SandboxPreset {
  export type Action = "ask" | "allow" | "deny"

  export type Permission = Record<string, Action | Record<string, Action>>

  export interface Def {
    mode: SandboxPolicy.Mode
    network: boolean
    protected_roots: string[]
    permission: Permission
    extra_read_roots: string[]
    extra_write_roots: string[]
  }

  export interface PartialDef {
    mode?: SandboxPolicy.Mode
    network?: boolean
    protected_roots?: string[]
    permission?: Permission
    extra_read_roots?: string[]
    extra_write_roots?: string[]
  }

  export interface Input extends PartialDef {
    preset?: string
    presets?: Record<string, PartialDef>
  }

  const make = (input: {
    mode?: SandboxPolicy.Mode
    network?: boolean
    protected_roots?: string[]
    permission?: Permission
    extra_read_roots?: string[]
    extra_write_roots?: string[]
  }): Def => ({
    mode: input.mode ?? "workspace-write",
    network: input.network ?? false,
    protected_roots: [...(input.protected_roots ?? Protected.workspace())],
    permission: { ...(input.permission ?? {}) },
    extra_read_roots: [...(input.extra_read_roots ?? [])],
    extra_write_roots: [...(input.extra_write_roots ?? [])],
  })

  const builtin: Record<string, Def> = {
    default: make({
      mode: "workspace-write",
      network: false,
    }),
    strict: make({
      mode: "read-only",
      network: false,
      permission: {
        bash: "ask",
        edit: "ask",
      },
    }),
    network: make({
      mode: "workspace-write",
      network: true,
    }),
  }

  export function names() {
    return Object.keys(builtin)
  }

  export function builtins(): Record<string, Def> {
    return Object.fromEntries(Object.entries(builtin).map(([key, value]) => [key, make(value)]))
  }

  function merge(base: Def, overrides?: PartialDef): Def {
    if (!overrides) return make(base)
    return {
      mode: overrides.mode ?? base.mode,
      network: overrides.network ?? base.network,
      protected_roots: overrides.protected_roots ? [...overrides.protected_roots] : [...base.protected_roots],
      permission: overrides.permission ? { ...overrides.permission } : { ...base.permission },
      extra_read_roots: overrides.extra_read_roots ? [...overrides.extra_read_roots] : [...base.extra_read_roots],
      extra_write_roots: overrides.extra_write_roots ? [...overrides.extra_write_roots] : [...base.extra_write_roots],
    }
  }

  export function resolve(name: string, input?: { presets?: Record<string, PartialDef>; overrides?: PartialDef }) {
    const base = builtin[name] ?? (input?.presets ? input.presets[name] : undefined)
    if (!base) throw new Error(`Unknown sandbox preset "${name}"`)
    return merge(make(base), input?.overrides)
  }

  export function active(input?: Input) {
    return resolve(input?.preset ?? "default", {
      presets: input?.presets,
      overrides: input
        ? {
            mode: input.mode,
            network: input.network,
            protected_roots: input.protected_roots,
            permission: input.permission,
            extra_read_roots: input.extra_read_roots,
            extra_write_roots: input.extra_write_roots,
          }
        : undefined,
    })
  }
}
