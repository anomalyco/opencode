import { Config } from "@/config/config"
import { Installation } from "@/installation"
import {
  checkPluginCompatibility,
  createPluginEntry,
  isDeprecatedPlugin,
  pluginSource,
  resolvePluginTarget,
  type PluginKind,
  type PluginPackage,
  type PluginSource,
} from "./shared"

export namespace PluginLoader {
  export type Plan = {
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

  type Row<T> = { item: T; plan: Plan }
  type Report<T> = {
    start?: (row: Row<T>, retry: boolean) => void
    missing?: (row: Row<T>, retry: boolean, message: string) => void
    error?: (
      row: Row<T>,
      retry: boolean,
      stage: "install" | "entry" | "compatibility" | "load",
      error: unknown,
      resolved?: Resolved,
    ) => void
  }

  export function plan(item: Config.PluginSpec): Plan {
    const spec = Config.pluginSpecifier(item)
    return { spec, options: Config.pluginOptions(item), deprecated: isDeprecatedPlugin(spec) }
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
      return { ok: false, stage: "install", error }
    }
    if (!target) return { ok: false, stage: "install", error: new Error(`Plugin ${plan.spec} target is empty`) }

    let base
    try {
      base = await createPluginEntry(plan.spec, target, kind)
    } catch (error) {
      return { ok: false, stage: "entry", error }
    }
    if (!base.entry)
      return { ok: false, stage: "missing", message: `Plugin ${plan.spec} does not expose a ${kind} entrypoint` }

    if (base.source === "npm") {
      try {
        await checkPluginCompatibility(base.target, Installation.VERSION, base.pkg)
      } catch (error) {
        return { ok: false, stage: "compatibility", error }
      }
    }
    return { ok: true, value: { ...plan, source: base.source, target: base.target, entry: base.entry, pkg: base.pkg } }
  }

  export async function load(row: Resolved): Promise<{ ok: true; value: Loaded } | { ok: false; error: unknown }> {
    let mod
    try {
      mod = await import(row.entry)
    } catch (error) {
      return { ok: false, error }
    }
    if (!mod) return { ok: false, error: new Error(`Plugin ${row.spec} module is empty`) }
    return { ok: true, value: { ...row, mod } }
  }

  async function attempt<T, R>(
    row: Row<T>,
    kind: PluginKind,
    retry: boolean,
    finish: ((load: Loaded, item: T, retry: boolean) => Promise<R | undefined>) | undefined,
    report: Report<T> | undefined,
  ): Promise<R | undefined> {
    const plan = row.plan
    if (plan.deprecated) return
    report?.start?.(row, retry)
    const resolved = await resolve(plan, kind)
    if (!resolved.ok) {
      if (resolved.stage === "missing") {
        report?.missing?.(row, retry, resolved.message)
        return
      }
      report?.error?.(row, retry, resolved.stage, resolved.error)
      return
    }
    const loaded = await load(resolved.value)
    if (!loaded.ok) {
      report?.error?.(row, retry, "load", loaded.error, resolved.value)
      return
    }
    if (!finish) return loaded.value as R
    return finish(loaded.value, row.item, retry)
  }

  export async function loadExternal<T, R = Loaded>(input: {
    rows: Row<T>[]
    kind: PluginKind
    wait?: () => Promise<void>
    finish?: (load: Loaded, item: T, retry: boolean) => Promise<R | undefined>
    report?: Report<T>
  }): Promise<R[]> {
    const list: Array<Promise<R | undefined>> = []
    for (const row of input.rows) list.push(attempt(row, input.kind, false, input.finish, input.report))
    const out = await Promise.all(list)
    if (input.wait) {
      let deps: Promise<void> | undefined
      for (let i = 0; i < input.rows.length; i++) {
        if (out[i] !== undefined) continue
        const row = input.rows[i]
        if (!row || pluginSource(row.plan.spec) !== "file") continue
        deps ??= input.wait()
        await deps
        out[i] = await attempt(row, input.kind, true, input.finish, input.report)
      }
    }
    const ready: R[] = []
    for (const item of out) if (item !== undefined) ready.push(item)
    return ready
  }
}
