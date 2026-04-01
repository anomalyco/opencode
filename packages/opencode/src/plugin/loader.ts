import { Config } from "@/config/config"
import { Installation } from "@/installation"
import {
  checkPluginCompatibility,
  createPluginEntry,
  isDeprecatedPlugin,
  resolvePluginTarget,
  type PluginKind,
  type PluginPackage,
  type PluginSource,
} from "./shared"

export namespace PluginLoader {
  export type Plan = {
    item: Config.PluginSpec
    spec: string
    options: Config.PluginOptions | undefined
    deprecated: boolean
  }

  export type Resolved = Plan & {
    source: PluginSource
    target: string
    entry: string
    pkg?: PluginPackage
  }

  export type Loaded = Resolved & {
    mod: Record<string, unknown>
  }

  export function plan(item: Config.PluginSpec): Plan {
    const spec = Config.pluginSpecifier(item)
    return {
      item,
      spec,
      options: Config.pluginOptions(item),
      deprecated: isDeprecatedPlugin(spec),
    }
  }

  export async function resolve(
    plan: Plan,
    kind: PluginKind,
  ): Promise<
    | { ok: true; value: Resolved }
    | { ok: false; stage: "missing"; message: string }
    | { ok: false; stage: "install" | "entry" | "compatibility"; error: unknown }
  > {
    let target = ""
    try {
      target = await resolvePluginTarget(plan.spec)
    } catch (error) {
      return {
        ok: false,
        stage: "install",
        error,
      }
    }
    if (!target) {
      return {
        ok: false,
        stage: "install",
        error: new Error(`Plugin ${plan.spec} target is empty`),
      }
    }

    let base
    try {
      base = await createPluginEntry(plan.spec, target, kind)
    } catch (error) {
      return {
        ok: false,
        stage: "entry",
        error,
      }
    }

    if (!base.entry) {
      return {
        ok: false,
        stage: "missing",
        message: `Plugin ${plan.spec} does not expose a ${kind} entrypoint`,
      }
    }

    if (base.source === "npm") {
      try {
        await checkPluginCompatibility(base.target, Installation.VERSION, base.pkg)
      } catch (error) {
        return {
          ok: false,
          stage: "compatibility",
          error,
        }
      }
    }

    return {
      ok: true,
      value: {
        ...plan,
        source: base.source,
        target: base.target,
        entry: base.entry,
        pkg: base.pkg,
      },
    }
  }

  export async function load(row: Resolved): Promise<{ ok: true; value: Loaded } | { ok: false; error: unknown }> {
    let mod
    try {
      mod = await import(row.entry)
    } catch (error) {
      return {
        ok: false,
        error,
      }
    }

    if (!mod) {
      return {
        ok: false,
        error: new Error(`Plugin ${row.spec} module is empty`),
      }
    }

    return {
      ok: true,
      value: {
        ...row,
        mod,
      },
    }
  }
}
