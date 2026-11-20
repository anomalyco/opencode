export * as WidgetTemplates from "./templates.js"

import type { StorageDomain } from "@opencode/plugin/effect/storage"
import { Widget } from "@opencode/schema/widget"
// Subpath imports: the package root also exports the step and live runners, which the server must never load.
import { validateData } from "@opencode/widget/json-schema"
import { program, version } from "@opencode/widget/program"
import { builtins } from "@opencode/widget/template"
import { WidgetLint } from "./lint.js"
import { Effect, Option, Schema } from "effect"

export class NotFoundError extends Schema.TaggedError<NotFoundError>()("Widget.TemplateNotFoundError", {
  name: Schema.String,
  version: Schema.optional(Schema.String),
}) {
  override get message() {
    return this.version === undefined
      ? `Widget template not found: ${this.name}`
      : `Widget template not found: ${this.name}@${this.version}`
  }
}

/** A template that cannot be saved: a bad name, a built-in name, a broken schema, or a program that fails to run. */
export class InvalidTemplateError extends Schema.TaggedError<InvalidTemplateError>()("Widget.InvalidTemplateError", {
  name: Schema.String,
  reason: Schema.String,
}) {
  override get message() {
    return `Invalid widget template "${this.name}": ${this.reason}`
  }
}

/** Data that does not match the template's schema, or that makes the template's `init` step fail. */
export class InvalidDataError extends Schema.TaggedError<InvalidDataError>()("Widget.InvalidDataError", {
  name: Schema.String,
  reason: Schema.String,
}) {
  override get message() {
    return `Invalid data for widget template "${this.name}": ${this.reason}`
  }
}

export interface SaveInput {
  readonly name: string
  readonly description: string
  readonly data: Widget.DataSchema
  readonly source: string
  /** `step` (default) or `live` (widgets-live.md). */
  readonly mode?: Widget.Mode
  /** Live templates only. */
  readonly capabilities?: Widget.Capabilities
  /**
   * Data checked against `data` before the template is stored. The server never runs template code; it only parses and
   * lints the source.
   */
  readonly example: Schema.Json
}

const decode = Schema.decodeUnknownSync(Widget.Template)
// Versions stored before templates had a mode are step templates.
const decodeOption = (value: unknown) =>
  Schema.decodeUnknownOption(Widget.Template)(
    typeof value === "object" && value !== null && !("mode" in value) ? { ...value, mode: "step" } : value,
  )
const builtin = new Map(builtins.map((template) => [template.name, decode(template)]))

// An exact host name, or `*.` and a host name for any subdomain of it.
const HOST = /^(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/

/** Why `capabilities` can't be stored on a template of `mode`, if they can't. */
export function capabilitiesProblem(mode: Widget.Mode, capabilities: Widget.Capabilities | undefined) {
  if (capabilities === undefined) return
  if (mode !== "live") return "only live templates can declare capabilities"
  const hosts = capabilities.https?.hosts
  if (hosts === undefined) return
  if (hosts.length === 0) return "https.hosts lists no hosts; leave https out instead"
  if (hosts.length > 32) return "https.hosts lists more than 32 hosts"
  const bad = hosts.find((host) => host !== "*" && !HOST.test(host))
  if (bad !== undefined)
    return `https.hosts entry ${JSON.stringify(bad)} is not a host name like "api.example.com", "*.example.com" or "*"`
}

// A version lives under its content address and never changes; `latest:<name>` names the newest saved one.
const versionKey = (name: string, version: string) => `template:${name}:${version}`
const latestKey = (name: string) => `latest:${name}`

export const toProgram = (template: Widget.Template): Widget.Program => ({
  ...template,
  program: program(template.source),
})

export const make = (storage: StorageDomain) => {
  const read = Effect.fnUntraced(function* (name: string, version: string) {
    return Option.getOrUndefined(decodeOption(yield* storage.get(versionKey(name, version))))
  })

  const savedLatest = Effect.fnUntraced(function* (name: string) {
    const version = yield* storage.get(latestKey(name))
    return typeof version === "string" ? yield* read(name, version) : undefined
  })

  const latest = Effect.fn("WidgetTemplates.latest")(function* (name: string) {
    const found = builtin.get(name) ?? (yield* savedLatest(name))
    if (!found) return yield* new NotFoundError({ name })
    return found
  })

  const get = Effect.fn("WidgetTemplates.get")(function* (name: string, version: string) {
    const current = builtin.get(name)
    const found = current?.version === version ? current : yield* read(name, version)
    if (!found) return yield* new NotFoundError({ name, version })
    return found
  })

  const list = Effect.fn("WidgetTemplates.list")(function* () {
    const saved: Widget.Template[] = []
    let after: string | undefined
    do {
      const page = yield* storage.scan({ prefix: "latest:", after, limit: 100 })
      for (const entry of page.entries) {
        const template = yield* savedLatest(entry.key.slice("latest:".length))
        if (template) saved.push(template)
      }
      after = page.next
    } while (after !== undefined)
    return [...builtin.values(), ...saved]
      .map(({ source: _, ...summary }): Widget.Summary => summary)
      .toSorted((a, b) => a.name.localeCompare(b.name))
  })

  /** Keeps a built-in version a widget uses, so it stays retrievable after a release changes the built-in. */
  const remember = Effect.fn("WidgetTemplates.remember")(function* (template: Widget.Template) {
    if (!template.builtin || (yield* storage.get(versionKey(template.name, template.version))) !== undefined) return
    yield* storage.set(versionKey(template.name, template.version), Schema.encodeSync(Widget.Template)(template))
  })

  // Data only: the server never runs a template, so `init` and `view` errors come back from clients (`report`).
  const check = Effect.fn("WidgetTemplates.check")(function* (template: Widget.Template, data: Schema.Json) {
    const errors = validateData(template.data, data)
    if (errors.length > 0)
      return yield* new InvalidDataError({ name: template.name, reason: errors.slice(0, 5).join("; ") })
  })

  const save = Effect.fn("WidgetTemplates.save")(function* (input: SaveInput) {
    const invalid = (reason: string) => new InvalidTemplateError({ name: input.name, reason })
    if (!Schema.is(Widget.Name)(input.name))
      return yield* invalid("names are lowercase letters, digits and dashes, starting with a letter, at most 48")
    if (builtin.has(input.name)) return yield* invalid("built-in templates cannot be overwritten")
    if (input.description.trim() === "") return yield* invalid("description is empty")
    if (input.data.type !== "object") return yield* invalid('the data schema must have type "object"')
    const mode = input.mode ?? "step"
    const problem = capabilitiesProblem(mode, input.capabilities)
    if (problem) return yield* invalid(problem)
    const template = decode({
      name: input.name,
      version: version(input.source, input.data, mode, input.capabilities),
      mode,
      ...(input.capabilities === undefined ? {} : { capabilities: input.capabilities }),
      description: input.description.trim(),
      data: input.data,
      source: input.source,
      builtin: false,
    })
    const issues = WidgetLint.lint(input.source, mode)
    if (issues.length > 0) return yield* invalid(WidgetLint.format(issues))
    yield* check(template, input.example).pipe(Effect.mapError((error) => invalid(`example: ${error.reason}`)))
    // The version first, so `latest` never names a version that is not stored. Saving existing content promotes it
    // again with the new description.
    yield* storage.set(versionKey(template.name, template.version), Schema.encodeSync(Widget.Template)(template))
    yield* storage.set(latestKey(template.name), template.version)
    return template
  })

  return { latest, get, list, remember, check, save }
}

export type Interface = ReturnType<typeof make>
