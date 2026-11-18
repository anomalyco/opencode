// Writes crates/plugin/src/luau/opencode/plugin.luau: the types of a Luau plugin, as a stub of the module
// `@opencode/plugin` that luau-analyze and luau-lsp resolve through a `.luaurc` alias (a definitions file cannot type a
// `require`). Every definition of contract 2.0's schema (crates/plugin-abi/schema/v2.json, which plugin-schema.ts
// writes first) becomes an `export type`, so a Luau plugin's tables are the contract's own shapes; the module and the
// `setup`, `read`, `host` and `view` objects are written here by hand, as crates/plugin/src/luau/bind.rs binds them.
type Schema = {
  $ref?: string
  type?: string | string[]
  enum?: (string | number | boolean | null)[]
  const?: string | number | boolean
  description?: string
  properties?: Record<string, Schema>
  required?: string[]
  additionalProperties?: boolean | Schema
  items?: Schema
  prefixItems?: Schema[]
  oneOf?: Schema[]
  anyOf?: Schema[]
  not?: Schema
  allOf?: Schema[]
}

const root = new URL("../..", import.meta.url).pathname
const schema = (await Bun.file(`${root}crates/plugin-abi/schema/v2.json`).json()) as {
  $defs: Record<string, Schema>
  "x-abi": { major: number; minor: number }
}
// The HTTP API's document, which the schema's references into `openapi.json` name (messages, sessions, models, events).
const openapi = (await Bun.file(`${root}../protocol/openapi.json`).json()) as {
  components: { schemas: Record<string, Schema> }
}
const components = openapi.components.schemas

// The HTTP API's schemas the stub writes, by the Luau name of each: what the contract's schema and the reads reach.
const reached = new Map<string, string>()

// The Luau name of the API's schema `name` (`Session.Message.Info` is `SessionMessageInfo`), which the stub then
// writes, with everything it reaches.
function server(name: string) {
  if (!components[name]) throw new Error(`plugin-types-luau: openapi.json has no schema ${name}`)
  const joined = name
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join("")
  // The contract's own type keeps the plain name (`LocationRef`); the API's of that name is `ApiLocationRef`.
  const luauName = schema.$defs[joined] ? `Api${joined}` : joined
  const known = reached.get(luauName)
  if (known !== undefined && known !== name)
    throw new Error(`plugin-types-luau: ${known} and ${name} are both ${luauName}`)
  reached.set(luauName, name)
  return luauName
}

// A reference into the API's document: a schema by name, or a part of one (`Tool/properties/id`), written in place.
function reference(fragment: string, indent: string): string {
  const [name, ...rest] = fragment.replace(/^\/components\/schemas\//, "").split("/")
  if (rest.length === 0) return server(name)
  const part = rest.reduce<any>((at, step) => at?.[step.replace(/~1/g, "/").replace(/~0/g, "~")], components[name])
  if (!part) throw new Error(`plugin-types-luau: openapi.json has no ${fragment}`)
  return luau(part, indent)
}

// `{ not: {} }` holds no value: an alternative that never matches.
function never(schema: Schema) {
  return schema.not !== undefined && Object.keys(schema.not).length === 0
}

// Luau's reserved words, which a table type names in brackets.
const reserved = new Set(
  "and break do else elseif end false for function if in local nil not or repeat return then true until while".split(
    " ",
  ),
)

function key(name: string) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && !reserved.has(name) ? name : `[${JSON.stringify(name)}]`
}

function literal(value: string | number | boolean | null) {
  if (value === null) return "nil"
  return typeof value === "string" ? JSON.stringify(value) : typeof value === "boolean" ? String(value) : "number"
}

function nullable(schema: Schema) {
  return schema.type === "null"
}

function union(types: string[]) {
  const unique = [...new Set(types)]
  return unique.length === 1 ? unique[0] : `(${unique.join(" | ")})`
}

// The Luau type of `schema`, indented by `indent` for its nested table types.
function luau(schema: Schema, indent: string): string {
  if (schema.$ref) {
    if (schema.$ref.startsWith("#/$defs/")) return schema.$ref.slice("#/$defs/".length)
    // `#/components/...` inside the API's document, `…/openapi.json#/components/...` from the contract's schema.
    const fragment = schema.$ref.split("#")[1]
    if (fragment?.startsWith("/components/schemas/")) return reference(fragment, indent)
    throw new Error(`plugin-types-luau: a reference this writer does not follow: ${schema.$ref}`)
  }
  if (schema.const !== undefined) return literal(schema.const)
  if (schema.enum) return union(schema.enum.map(literal))
  const alternatives = schema.oneOf ?? schema.anyOf
  if (alternatives) {
    const present = alternatives.filter((alternative) => !nullable(alternative) && !never(alternative))
    const type = union(present.map((alternative) => luau(alternative, indent)))
    // `any` holds `nil` already, and `any?` as a read-write field is invariant: a table built in a local fails it.
    return present.length < alternatives.length && type !== "any" ? `${type}?` : type
  }
  // Parenthesized, because Luau refuses `A & B` beside `|` in one type.
  if (schema.allOf) {
    const parts = schema.allOf.map((part) => luau(part, indent))
    return parts.length === 1 ? parts[0] : `(${parts.join(" & ")})`
  }
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type
  switch (type) {
    case "string":
      return "string"
    case "integer":
    case "number":
      return "number"
    case "boolean":
      return "boolean"
    case "null":
      return "nil"
    case "array": {
      const items = schema.items ?? (schema.prefixItems ? { anyOf: schema.prefixItems } : {})
      return `{ ${luau(items, indent)} }`
    }
    case "object":
    case undefined: {
      if (!schema.properties) {
        if (typeof schema.additionalProperties === "object")
          return `{ [string]: ${luau(schema.additionalProperties, indent)} }`
        return type === "object" ? "{ [string]: any }" : "any"
      }
      return fields(schema.properties, new Set(schema.required ?? []), indent)
    }
  }
  return "any"
}

// A table type of `properties`, each optional unless `required` names it.
function fields(properties: Record<string, Schema>, required: Set<string>, indent: string) {
  const inner = indent + "    "
  const lines = Object.entries(properties).map(([name, field]) => {
    const type = luau(field, inner)
    const optional = required.has(name) || type.endsWith("?") || type === "any" ? "" : "?"
    return `${inner}${key(name)}: ${type}${optional},`
  })
  return `{\n${lines.join("\n")}\n${indent}}`
}

// What a helper's `props` may set: the fields of `schema` (or of its `oneOf` variant whose `type` is `kind`) but
// `omit`, all optional.
function props(schema: Schema, omit: string[], kind?: string) {
  const variant = kind ? schema.oneOf?.find((variant) => variant.properties?.type?.const === kind) : schema
  if (!variant?.properties) throw new Error(`plugin-types-luau: no ${kind ?? "object"} in the schema for the helpers`)
  return fields(
    Object.fromEntries(Object.entries(variant.properties).filter(([name]) => !omit.includes(name))),
    new Set(),
    "",
  )
}

// The fields of `schema` (or of its `oneOf` variant whose `type` is `kind`) but `omit`, required as the schema says.
function shape(schema: Schema, omit: string[], kind?: string) {
  const variant = kind ? schema.oneOf?.find((variant) => variant.properties?.type?.const === kind) : schema
  if (!variant?.properties) throw new Error(`plugin-types-luau: no ${kind ?? "object"} in the schema for a dialog`)
  return fields(
    Object.fromEntries(Object.entries(variant.properties).filter(([name]) => !omit.includes(name))),
    new Set(variant.required ?? []),
    "",
  )
}

function comment(text: string | undefined, indent = "") {
  if (!text) return []
  return text.split("\n").map((line) => `${indent}--- ${line}`)
}

const generated = Object.keys(schema.$defs)
  .toSorted()
  .flatMap((name) => [
    ...comment(schema.$defs[name].description),
    `export type ${name} = ${luau(schema.$defs[name], "")}`,
    "",
  ])

// The reads, as `Read` and `Host` both carry them. `Host` repeats them with `self: Read` instead of being `Read & {…}`:
// one table type is a subtype of `Read` by width, where an intersection of method tables trips the solver.
const reads = `    themeMode: (self: Read) -> "dark" | "light",
    color: (self: Read, token: string) -> Rgba?,
    storageGet: (self: Read, key: string) -> any,
    session: (self: Read, id: string) -> Session?,
    sessions: (self: Read) -> { Session },
    family: (self: Read, id: string) -> Family,
    messages: (self: Read, id: string) -> { ${server("Session.Message.Info")} },
    --- The inbox items of session \`id\` the server has not delivered yet, oldest first; empty while its inbox is not loaded.
    pending: (self: Read, id: string) -> { ${server("Session.Inbox.Info")} },
    --- The models of \`location\`, or where the TUI works; \`nil\` while they are not loaded.
    models: (self: Read, location: LocationRef?) -> { ${server("Model.Info")} }?,
    --- The providers where the TUI works; \`nil\` while they are not loaded.
    providers: (self: Read) -> { ${server("Provider.Info")} }?,
    --- The OpenCode Console workspace's usage limits; \`nil\` while they are not loaded.
    limits: (self: Read) -> ${server("UsageLimits.Info")}?,
    model: (self: Read) -> ${server("Model.Ref")}?,
    info: (self: Read) -> Info,
    route: (self: Read) -> Route,
    interactive: (self: Read) -> boolean,
    shortcut: (self: Read, name: string) -> string?,
    dialogOpen: (self: Read, key: string) -> boolean,
    composer: (self: Read) -> Composer?,
    tabs: (self: Read) -> { Tab },
    --- Whether session tabs are on in this TUI.
    tabsEnabled: (self: Read) -> boolean,
    theme: (self: Read) -> string?,
    themes: (self: Read) -> { string },
    selection: (self: Read) -> string?,
    rect: (self: Read, id: string) -> NodeRect?,
    focused: (self: Read) -> Focused,
    mode: (self: Read) -> string?,
    mount: (self: Read) -> MountId?,
    setting: (self: Read, name: string) -> any,
    plugins: (self: Read) -> { PluginEntry },
    --- The host's version and its optional features.
    abi: (self: Read) -> Abi,
    --- Whether the host has optional feature \`name\` (\`plugin.FOCUS_INPUT\`, \`plugin.FENCE_NODE\`).
    hasFeature: (self: Read, name: string) -> boolean,
`

// The module and the objects a plugin's calls are handed, as bind.rs binds them.
const api = `-- The plugin's objects -------------------------------------------------------------------------------------------

--- What a render or a view reads; every read of one call sees one store snapshot.
export type Read = {
${reads}}

--- The version a host serves the plugin: its major, its minor of that major, and its optional features.
export type Abi = { major: number, minor: number, features: { string } }

--- What a handler acts with: the reads, and effects, which wait until the outermost call returns. A render or a view
--- that calls an effect fails. The waiting calls (\`fetch\`, \`foreground\`, \`select\`, \`prompt\`, \`confirm\`, \`alert\`) park
--- the task that calls them and return its answer.
export type Host = {
${reads}    storageSet: (self: Host, key: string, value: { [any]: any }) -> (),
    storageMerge: (self: Host, key: string, fields: { [string]: any }) -> (),
    dispatch: (self: Host, name: string, input: string?) -> (),
    toast: (self: Host, toast: Toast) -> (),
    attention: (self: Host, attention: Attention) -> (),
    openRoute: (self: Host, name: string) -> (),
    navigate: (self: Host, route: Route) -> (),
    dialog: (self: Host, dialog: Dialog) -> (),
    copy: (self: Host, text: string, thenAction: Action?) -> (),
    editComposer: (self: Host, edit: ComposerEdit) -> (),
    setTitle: (self: Host, title: string) -> (),
    setVariant: (self: Host, variant: string?) -> boolean,
    setModel: (self: Host, provider: string, model: string) -> (),
    editTab: (self: Host, edit: TabEdit) -> boolean,
    clearSelection: (self: Host) -> (),
    setTheme: (self: Host, name: string) -> boolean,
    setSetting: (self: Host, name: string, value: any) -> (),
    scroll: (self: Host, target: Target, verb: Scroll) -> (),
    openPanel: (self: Host, open: OpenPanel) -> (),
    closePanel: (self: Host, surface: string) -> (),
    overlay: (self: Host, overlay: Overlay) -> (),
    closeOverlay: (self: Host, surface: string) -> (),
    focus: (self: Host, id: string) -> (),
    blur: (self: Host) -> (),
    setMode: (self: Host, mode: string?) -> (),
    releaseKeys: (self: Host) -> (),
    --- Waits for the reply: its body (\`nil\` without one), or \`nil\` and the error, also when the host did not take
    --- the request. Only a task waits (\`plugin.spawn\`).
    fetch: (self: Host, fetch: Fetch) -> (any, string?),
    --- Waits until the program exits: its exit code (\`nil\` when a signal ended it, which \`signal\` names), or \`nil\`
    --- and why it did not start.
    foreground: (self: Host, program: Foreground) -> ({ code: number?, signal: string? }?, string?),
    --- Shows a select and waits: the value of the option picked, or \`nil\` when it closed without one.
    select: (self: Host, select: SelectSpec) -> string?,
    --- Shows a one-line prompt and waits: the text entered, or \`nil\` when it closed without one.
    prompt: (self: Host, prompt: PromptSpec) -> string?,
    --- Shows a confirm and waits: \`true\` or \`false\`, or \`nil\` when it closed without an answer.
    confirm: (self: Host, confirm: ConfirmSpec) -> boolean?,
    --- Shows an alert and waits until it closed.
    alert: (self: Host, alert: AlertSpec) -> (),
}

--- A select as \`host:select\` shows it: the contract's \`Select\` without its \`action\`.
export type SelectSpec = ${shape(schema.$defs.Select, ["action"])}

--- A prompt as \`host:prompt\` shows it.
export type PromptSpec = ${shape(schema.$defs.Dialog, ["type", "action"], "prompt")}

--- A confirm as \`host:confirm\` shows it: the contract's \`Confirm\` without its \`action\`.
export type ConfirmSpec = ${shape(schema.$defs.Confirm, ["action"])}

--- An alert as \`host:alert\` shows it.
export type AlertSpec = ${shape(schema.$defs.Alert, ["action"])}

--- A surface's view: what it reads, its input, and a memo that keeps a subtree while its value stays.
export type View = {
    read: Read,
    input: SurfaceInput,
    memo: (self: View, key: string, value: any, build: (view: View) -> Node) -> Node,
}

--- Where a slot claim goes; \`kind\` is \`append\` when left out.
export type At = { path: string, kind: SlotKind? }

--- A command; only \`name\` is needed, the rest are the contract's defaults.
export type CommandSpec = { name: string, title: string?, palette: boolean?, group: string?, slash: string?, keybind: string?, description: string?, arguments: boolean?, scope: Scope? }

--- A surface as \`setup:surface\` takes it.
export type SurfaceSpec = { name: string, place: SurfacePlace, layers: { Layer }?, mounts: boolean?, palette: boolean? }

--- What setup registers on; each method holds only while setup runs. A handler given a \`host\` (a command's, an
--- event's, a mount's, a layer's or a surface's) runs as a task, so it may wait; a key handler that waits has taken its
--- key. Renders, views, code blocks and \`onDispose\` read only and cannot wait.
export type Setup = {
    id: string,
    --- The \`options\` of the plugin's \`plugins\` entry, decoded.
    options: any,
    host: Host,
    storageKey: (self: Setup, key: string) -> (),
    command: (self: Setup, command: CommandSpec, run: (host: Host, input: string?) -> ()) -> (),
    slot: (self: Setup, at: At, render: (read: Read, input: SlotInput, changed: Changed) -> Render?) -> (),
    --- Calls \`run\` as the host mounts the claim registered last at \`at\` (\`true\`, before it first renders) and as it
    --- unmounts it (\`false\`).
    onMount: (self: Setup, at: At, run: (host: Host, input: SlotInput, mounted: boolean) -> ()) -> (),
    route: (self: Setup, name: string, render: (read: Read, changed: Changed) -> Render?) -> (),
    onRouteMount: (self: Setup, name: string, run: (host: Host, mounted: boolean) -> ()) -> (),
    codeBlock: (self: Setup, language: string, render: (read: Read, fence: Fence) -> Fenced?) -> (),
    --- \`event\` is one of the API's events, a union tagged by \`type\`: \`if event.type == "…" then\` narrows it.
    onEvent: (self: Setup, types: { string }, run: (host: Host, event: ${server("V2Event")}) -> ()) -> (),
    onDispose: (self: Setup, run: (host: Host) -> ()) -> (),
    layer: (self: Setup, layer: Layer, handler: (host: Host, event: InputEvent) -> Handled?) -> (),
    surface: (self: Setup, surface: SurfaceSpec, view: (view: View) -> Node, handler: ((host: Host, event: InputEvent) -> Handled?)?) -> (),
}

--- The style \`plugin.span\` adds to a span's text.
export type SpanStyle = ${props(schema.$defs.Span, ["text"])}

--- The fields \`plugin.text\` adds to a text node.
export type TextProps = ${props(schema.$defs.Node, ["type", "spans"], "text")}

--- The fields \`plugin.column\` and \`plugin.row\` add to a box.
export type BoxProps = ${props(schema.$defs.Node, ["type", "row", "children"], "box")}

--- \`require("@opencode/plugin")\`.
export type Plugin = {
    contract: string,
    IMAGE_BOUNDS: string,
    FOCUS_INPUT: string,
    FENCE_NODE: string,
    KEEP: Render,
    HIDE: Render,
    define: (setup: (setup: Setup) -> ()) -> any,
    span: (text: string, style: SpanStyle?) -> Span,
    text: (content: string | { Span }, props: TextProps?) -> Node,
    column: (children: { Node }, props: BoxProps?) -> Node,
    row: (children: { Node }, props: BoxProps?) -> Node,
    --- A slot or route render of \`node\`; the host draws it with the node kinds a render takes (box, text, slot,
    --- markdown and spinner).
    show: (node: Node) -> Render,
    command: (name: string, input: string?) -> Action,
    click: (name: string, input: string?) -> Click,
    --- Starts \`f(...)\` as a task of its own, from a handler, a task or setup; it runs until it ends or waits.
    spawn: (f: (...any) -> ...any, ...any) -> (),
    --- Runs each function as a task and waits until all ended: their values in order, or \`nil\` and the error of the
    --- first that returned one. Only a task waits.
    all: (fns: { () -> (any, any) }) -> ({ any }?, any),
    --- JSON with the host's reader and writer, under the bounds of any value a plugin hands the host.
    json: Json,
    --- Sorts \`list\` in place by \`less\` (\`a < b\` when left out) and returns it; equal items keep their order.
    sort: <T>(list: { T }, less: ((T, T) -> boolean)?) -> { T },
}

--- \`plugin.json\`. A table is a JSON array when its keys are \`1..n\` (an empty table is one), an object otherwise, and a
--- table with the object marker is an object whatever its keys; a table the host builds from JSON carries its marker.
export type Json = {
    --- JSON's \`null\` where a table must hold it: what \`decode\` gives with \`{ null = true }\`.
    null: any,
    --- \`text\` as a value and \`nil\`, or \`nil\` and why. A \`null\` field is left out and a \`null\` item is \`null\`; with
    --- \`{ null = true }\` every \`null\` is \`null\`.
    decode: (text: string, options: { null: boolean? }?) -> (any, string?),
    --- The JSON text of \`value\`.
    encode: (value: any) -> string,
    --- Whether table \`t\` goes to JSON as an array.
    isArray: (t: { [any]: any }) -> boolean,
    --- Marks \`t\` an array, and returns it: an empty one goes as \`[]\`.
    array: <T>(t: T) -> T,
    --- Marks \`t\` an object, and returns it: an empty one goes as \`{}\`.
    object: <T>(t: T) -> T,
}
`

const header = `--!strict
-- OpenCode plugin contract ${schema["x-abi"].major}.${schema["x-abi"].minor}: the types of a Luau plugin, as the module \`@opencode/plugin\`.
-- Generated from crates/plugin-abi/schema/v2.json by \`bun run generate\` (script/gen/plugin-types-luau.ts). Do not edit.
--
-- The host registers the real module; this file only types it for luau-analyze and luau-lsp. Point the alias
-- \`opencode\` at this directory in a \`.luaurc\` beside your plugin or above it:
--   { "languageMode": "strict", "aliases": { "opencode": "<path to crates/plugin/src/luau/opencode>" } }
-- then \`luau-analyze --formatter=gnu <your .luau files>\` or open the plugin in luau-lsp. At run time the host keeps
-- \`@opencode\` its own whatever a \`.luaurc\` says, and reads no \`.luaurc\` outside the plugin. Require your own modules
-- by Luau's rules: \`@self/x\` in \`init.luau\`, \`./x\` in the other modules.
--
-- A handler that acts is a task: \`local ok = host:confirm({ ... })\` and \`local body, err = host:fetch({ ... })\` wait in
-- a straight line, and the plugin goes on with other calls meanwhile. A fetch its mount asked for, when that mount
-- closes before the reply, returns \`nil, "cancelled"\` once: the host cancelled the request.

-- The contract's definitions ----------------------------------------------------------------------------------------
`

const footer = `
local plugin: Plugin = nil :: any
return plugin
`

// The API's schemas the contract and the reads reached, and what those reach in turn, by Luau name.
const written = new Map<string, string>()
for (
  let pending = [...reached.keys()];
  pending.length > 0;
  pending = [...reached.keys()].filter((name) => !written.has(name))
)
  for (const name of pending) {
    const source = reached.get(name)!
    written.set(
      name,
      [...comment(components[source].description), `export type ${name} = ${luau(components[source], "")}`, ""].join(
        "\n",
      ),
    )
  }
const served = [...written.keys()].toSorted().map((name) => written.get(name)!)

const file = `${root}crates/plugin/src/luau/opencode/plugin.luau`
await Bun.write(
  file,
  `${header}\n${generated.join("\n")}\n-- The HTTP API's types (packages/protocol/openapi.json) ${"-".repeat(57)}\n\n${served.join("\n")}\n${api}${footer}`,
)
console.log(`plugin-types-luau: ${Object.keys(schema.$defs).length} definitions, ${written.size} of the API's schemas`)
