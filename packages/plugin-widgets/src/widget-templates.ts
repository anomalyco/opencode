export * as WidgetTemplates from "./widget-templates.js"

import type { StorageDomain } from "@opencode/plugin/effect/storage"
import { Widget } from "@opencode/schema/widget"
// Subpath imports: the package root also exports the step and live runners, which the server must never load.
import { validateData } from "@opencode/widget/json-schema"
import { program, version } from "@opencode/widget/program"
import { builtins } from "@opencode/widget/widget-template"
import { WidgetLint } from "./lint.js"
import { Effect, Option, Schema } from "effect"

export class NotFoundError extends Schema.TaggedError<NotFoundError>()("Widget.WidgetTemplateNotFoundError", {
  name: Schema.String,
  version: Schema.optional(Schema.String),
}) {
  override get message() {
    return this.version === undefined
      ? `Widget template not found: ${this.name}`
      : `Widget template not found: ${this.name}@${this.version}`
  }
}

/** A widget template that cannot be saved: a bad name, a built-in name, a broken schema, or a program that fails to run. */
export class InvalidWidgetTemplateError extends Schema.TaggedError<InvalidWidgetTemplateError>()(
  "Widget.InvalidWidgetTemplateError",
  {
    name: Schema.String,
    reason: Schema.String,
  },
) {
  override get message() {
    return `Invalid widget template "${this.name}": ${this.reason}`
  }
}

/** Data that does not match the widget template's schema, or that makes the widget template's `init` step fail. */
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
  /** Live widget templates only. */
  readonly capabilities?: Widget.Capabilities
  /**
   * Data checked against `data` before the widget template is stored. The server never runs widget template code; it only parses and
   * lints the source.
   */
  readonly example: Schema.Json
  /** The Session whose `widget_template` call saves it; recorded when the version is first stored. */
  readonly origin?: string
}

/** An `edit`: exact-text replacements on the latest source of `name`, or of `from` copied to the new `name`. */
export interface EditInput {
  readonly name: string
  readonly from?: string
  readonly edits: ReadonlyArray<{ readonly oldText: string; readonly newText: string }>
  readonly description?: string
  readonly data?: Widget.DataSchema
  /** Required when `data` changes; otherwise the stored schema was already checked. */
  readonly example?: Schema.Json
  readonly origin?: string
}

/** How the server builds a version's program; the current prelude by default, another one in tests. */
export interface Builder {
  readonly program: (source: string, mode: Widget.Mode) => string
}
const current: Builder = { program }

// A stored version: the widget template, the exact program it was saved with, and the Session that created it (none for
// built-ins). The origin decides whether the widget's failures reach the agent on their own (widgets.md, Failures).
const Stored = Schema.Struct({
  ...Widget.WidgetTemplate.fields,
  program: Schema.optional(Schema.String),
  origin: Schema.optional(Schema.String),
})
const decode = Schema.decodeUnknownSync(Widget.WidgetTemplate)
const encodeStored = Schema.encodeSync(Stored)
// Versions stored before widget templates had a mode are step widget templates.
const decodeOption = (value: unknown) =>
  Schema.decodeUnknownOption(Stored)(
    typeof value === "object" && value !== null && !("mode" in value) ? { ...value, mode: "step" } : value,
  )

// An exact host name, or `*.` and a host name for any subdomain of it, with an optional port. Single labels and IPv4
// literals (`localhost`, `127.0.0.1`, `*.local`, `localhost:4097`) are for clients' dev-mode local network
// (widgets-live.md); clients refuse them otherwise.
const HOST = /^(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:\d{1,5})?$/

/** Why `capabilities` can't be stored on a widget template of `mode`, if they can't. */
export function capabilitiesProblem(mode: Widget.Mode, capabilities: Widget.Capabilities | undefined) {
  if (capabilities === undefined) return
  if (mode !== "live") return "only live widget templates can declare capabilities"
  const hosts = capabilities.https?.hosts
  if (hosts === undefined) return
  if (hosts.length === 0) return "https.hosts lists no hosts; leave https out instead"
  if (hosts.length > 32) return "https.hosts lists more than 32 hosts"
  const bad = hosts.find((host) => host !== "*" && !HOST.test(host))
  if (bad !== undefined)
    return `https.hosts entry ${JSON.stringify(bad)} is not a host name like "api.example.com", "*.example.com", "localhost:4097" or "*"`
}

// A version lives under its content address and never changes; `widget_template_latest:<name>` names the newest saved one.
const versionKey = (name: string, version: string) => `widget_template:${name}:${version}`
const latestKey = (name: string) => `widget_template_latest:${name}`
// The 1-based number of a saved version among its widget template's versions, in the order they were first saved.
const revisionKey = (name: string, version: string) => `widget_template_revision:${name}:${version}`

/** A widget template without its program, for `get` and summaries. */
export const withoutProgram = ({ program: _, ...widgetTemplate }: Widget.Program): Widget.WidgetTemplate =>
  widgetTemplate

export const make = (storage: StorageDomain, builder: Builder = current) => {
  // Built-ins are hashed with the prelude they ship with, which is the one the server runs now.
  const builtin = new Map(
    builtins.map((widgetTemplate) => {
      const decoded = decode(widgetTemplate)
      return [
        decoded.name,
        { ...decoded, program: builder.program(decoded.source, decoded.mode) } satisfies Widget.Program,
      ]
    }),
  )

  // A version is served with the program it was stored with, never rebuilt with a newer prelude.
  const read = Effect.fnUntraced(function* (name: string, version: string) {
    const stored = Option.getOrUndefined(decodeOption(yield* storage.get(versionKey(name, version))))
    if (!stored) return undefined
    const { origin: _, program: text, ...widgetTemplate } = stored
    return {
      ...widgetTemplate,
      program: text ?? builder.program(widgetTemplate.source, widgetTemplate.mode),
    } satisfies Widget.Program
  })
  const store = (widgetTemplate: Widget.Program, origin?: string) =>
    storage.set(
      versionKey(widgetTemplate.name, widgetTemplate.version),
      encodeStored(origin === undefined ? widgetTemplate : { ...widgetTemplate, origin }),
    )

  /** The Session that created a saved version; undefined for built-ins and versions saved before origins were kept. */
  const origin = Effect.fn("WidgetTemplates.origin")(function* (name: string, version: string) {
    const stored = Option.getOrUndefined(decodeOption(yield* storage.get(versionKey(name, version))))
    return stored?.builtin ? undefined : stored?.origin
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
    const saved: Widget.Program[] = []
    let after: string | undefined
    do {
      const page = yield* storage.scan({ prefix: "widget_template_latest:", after, limit: 100 })
      for (const entry of page.entries) {
        const widgetTemplate = yield* savedLatest(entry.key.slice("widget_template_latest:".length))
        if (widgetTemplate) saved.push(widgetTemplate)
      }
      after = page.next
    } while (after !== undefined)
    return [...builtin.values(), ...saved]
      .map(({ source: _, program: __, ...summary }): Widget.Summary => summary)
      .toSorted((a, b) => a.name.localeCompare(b.name))
  })

  /** Keeps a built-in version a widget uses, so it stays retrievable after a release changes the built-in. */
  const remember = Effect.fn("WidgetTemplates.remember")(function* (widgetTemplate: Widget.Program) {
    if (
      !widgetTemplate.builtin ||
      (yield* storage.get(versionKey(widgetTemplate.name, widgetTemplate.version))) !== undefined
    )
      return
    yield* store(widgetTemplate)
  })

  // Data only: the server never runs a widget template, so `init` and `view` errors come back from clients (`report`).
  const check = Effect.fn("WidgetTemplates.check")(function* (
    widgetTemplate: Widget.WidgetTemplate,
    data: Schema.Json,
  ) {
    const errors = validateData(widgetTemplate.data, data)
    if (errors.length > 0)
      return yield* new InvalidDataError({ name: widgetTemplate.name, reason: errors.slice(0, 5).join("; ") })
  })

  /** A saved version's revision number (1 for the first version of a name), or undefined for built-ins. */
  const revision = Effect.fn("WidgetTemplates.revision")(function* (name: string, version: string) {
    const stored = yield* storage.get(revisionKey(name, version))
    return typeof stored === "number" ? stored : undefined
  })

  const save = (input: SaveInput) => create(input)

  // `save` and `edit`: validates, lints, checks the example when there is one, and stores the version.
  const create = Effect.fn("WidgetTemplates.save")(function* (
    input: Omit<SaveInput, "example"> & { example?: Schema.Json },
  ) {
    const invalid = (reason: string) => new InvalidWidgetTemplateError({ name: input.name, reason })
    if (!Schema.is(Widget.Name)(input.name))
      return yield* invalid("names are lowercase letters, digits and dashes, starting with a letter, at most 48")
    if (builtin.has(input.name)) return yield* invalid("built-in widget templates cannot be overwritten")
    if (input.description.trim() === "") return yield* invalid("description is empty")
    if (input.data.type !== "object") return yield* invalid('the data schema must have type "object"')
    const mode = input.mode ?? "step"
    const problem = capabilitiesProblem(mode, input.capabilities)
    if (problem) return yield* invalid(problem)
    const text = builder.program(input.source, mode)
    const widgetTemplate = decode({
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
    if (input.example !== undefined)
      yield* check(widgetTemplate, input.example).pipe(Effect.mapError((error) => invalid(`example: ${error.reason}`)))
    // The version first, so `latest` never names a version that is not stored. Saving existing content promotes it
    // again with the new description, and keeps the Session that first created it.
    yield* store(
      { ...widgetTemplate, program: text },
      (yield* origin(widgetTemplate.name, widgetTemplate.version)) ?? input.origin,
    )
    if ((yield* revision(widgetTemplate.name, widgetTemplate.version)) === undefined)
      yield* storage.set(revisionKey(widgetTemplate.name, widgetTemplate.version), yield* count(widgetTemplate.name))
    yield* storage.set(latestKey(widgetTemplate.name), widgetTemplate.version)
    return { ...widgetTemplate, program: text } satisfies Widget.Program
  })

  // How many versions of `name` are stored.
  const count = Effect.fnUntraced(function* (name: string) {
    let total = 0
    let after: string | undefined
    do {
      const page = yield* storage.scan({ prefix: `widget_template:${name}:`, after, limit: 100 })
      total += page.entries.length
      after = page.next
    } while (after !== undefined)
    return total
  })

  const edit = Effect.fn("WidgetTemplates.edit")(function* (input: EditInput) {
    const invalid = (reason: string) => new InvalidWidgetTemplateError({ name: input.name, reason })
    if (input.from === undefined && builtin.has(input.name))
      return yield* invalid(
        `built-in widget templates can't be edited; copy it under a new name: { action: "edit", name: "my-${input.name}", from: "${input.name}", edits }`,
      )
    const origin = input.from ?? input.name
    const base = yield* latest(origin)
    if (input.edits.length === 0) return yield* invalid("`edits` is empty")
    let source = base.source
    for (const [index, change] of input.edits.entries()) {
      const at = `edit ${index + 1}`
      if (change.oldText === "") return yield* invalid(`${at}: oldText is empty`)
      if (change.oldText === change.newText) return yield* invalid(`${at}: oldText and newText are the same`)
      const matches = source.split(change.oldText).length - 1
      if (matches === 0)
        return yield* invalid(
          `${at}: oldText was not found in the source of "${origin}"${index > 0 ? " after the earlier edits" : ""}; it must match exactly, whitespace included (get the widget template to see it)`,
        )
      if (matches > 1)
        return yield* invalid(
          `${at}: oldText matches ${matches} times; include more surrounding text so it matches once`,
        )
      // A function replacement, so `$` in newText is taken literally.
      source = source.replace(change.oldText, () => change.newText)
    }
    if (input.data !== undefined && input.example === undefined)
      return yield* invalid("`example` is required when `data` changes")
    return yield* create({
      name: input.name,
      description: input.description ?? base.description,
      data: input.data ?? base.data,
      source,
      mode: base.mode,
      ...(base.capabilities === undefined ? {} : { capabilities: base.capabilities }),
      ...(input.example === undefined ? {} : { example: input.example }),
      ...(input.origin === undefined ? {} : { origin: input.origin }),
    })
  })

  return { latest, get, list, remember, check, save, edit, revision, origin }
}

export type Interface = ReturnType<typeof make>
