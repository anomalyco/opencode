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
  export type Missing = Plan & {
    source: PluginSource
    target: string
    pkg?: PluginPackage
    message: string
  }
  export type Loaded = Resolved & {
    mod: Record<string, unknown>
  }

  type Candidate = { origin: Config.PluginOrigin; plan: Plan }
  type Report = {
    start?: (candidate: Candidate, retry: boolean) => void
    missing?: (candidate: Candidate, retry: boolean, message: string, resolved: Missing) => void
    error?: (
      candidate: Candidate,
      retry: boolean,
      stage: "install" | "entry" | "compatibility" | "load",
      error: unknown,
      resolved?: Resolved,
    ) => void
  }

  function plan(item: Config.PluginSpec): Plan {
    const spec = Config.pluginSpecifier(item)
    return { spec, options: Config.pluginOptions(item), deprecated: isDeprecatedPlugin(spec) }
  }

  export async function resolve(
    plan: Plan,
    kind: PluginKind,
  ): Promise<
    | { ok: true; value: Resolved }
    | { ok: false; stage: "missing"; value: Missing }
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
      return {
        ok: false,
        stage: "missing",
        value: {
          ...plan,
          source: base.source,
          target: base.target,
          pkg: base.pkg,
          message: `Plugin ${plan.spec} does not expose a ${kind} entrypoint`,
        },
      }

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

  async function attempt<R>(
    candidate: Candidate,
    kind: PluginKind,
    retry: boolean,
    finish: ((load: Loaded, origin: Config.PluginOrigin, retry: boolean) => Promise<R | undefined>) | undefined,
    missing: ((value: Missing, origin: Config.PluginOrigin, retry: boolean) => Promise<R | undefined>) | undefined,
    report: Report | undefined,
  ): Promise<R | undefined> {
    const plan = candidate.plan
    if (plan.deprecated) return
    report?.start?.(candidate, retry)
    const resolved = await resolve(plan, kind)
    if (!resolved.ok) {
      if (resolved.stage === "missing") {
        if (missing) {
          const value = await missing(resolved.value, candidate.origin, retry)
          if (value !== undefined) return value
        }
        report?.missing?.(candidate, retry, resolved.value.message, resolved.value)
        return
      }
      report?.error?.(candidate, retry, resolved.stage, resolved.error)
      return
    }
    const loaded = await load(resolved.value)
    if (!loaded.ok) {
      report?.error?.(candidate, retry, "load", loaded.error, resolved.value)
      return
    }
    if (!finish) return loaded.value as R
    return finish(loaded.value, candidate.origin, retry)
  }

  type Input<R> = {
    items: Config.PluginOrigin[]
    kind: PluginKind
    wait?: () => Promise<void>
    finish?: (load: Loaded, origin: Config.PluginOrigin, retry: boolean) => Promise<R | undefined>
    missing?: (value: Missing, origin: Config.PluginOrigin, retry: boolean) => Promise<R | undefined>
    report?: Report
  }

  export async function loadExternal<R = Loaded>(input: Input<R>): Promise<R[]> {
    const candidates = input.items.map((origin) => ({ origin, plan: plan(origin.spec) }))
    const list: Array<Promise<R | undefined>> = []
    for (const candidate of candidates) {
      list.push(attempt(candidate, input.kind, false, input.finish, input.missing, input.report))
    }
    const out = await Promise.all(list)
    if (input.wait) {
      let deps: Promise<void> | undefined
      for (let i = 0; i < candidates.length; i++) {
        if (out[i] !== undefined) continue
        const candidate = candidates[i]
        if (!candidate || pluginSource(candidate.plan.spec) !== "file") continue
        deps ??= input.wait()
        await deps
        out[i] = await attempt(candidate, input.kind, true, input.finish, input.missing, input.report)
      }
    }
    const ready: R[] = []
    for (const item of out) if (item !== undefined) ready.push(item)
    return ready
  }
}
