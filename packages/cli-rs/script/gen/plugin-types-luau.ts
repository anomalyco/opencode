// Writes crates/plugin/src/luau/opencode.d.luau: the types of a Luau plugin (spike `luau-spike`). Every definition of
// contract 2.0's schema (crates/plugin-abi/schema/v2.json, which plugin-schema.ts writes first) becomes an `export
// type`, so a Luau plugin's tables are the contract's own shapes; the module `@opencode/plugin` and the `setup`,
// `read`, `host` and `view` objects are written here by hand, as crates/plugin/src/luau/bind.rs binds them.
type Schema = {
  $ref?: string
  type?: string | string[]
  enum?: (string | number)[]
  const?: string | number | boolean
  description?: string
  properties?: Record<string, Schema>
  required?: string[]
  additionalProperties?: boolean | Schema
  items?: Schema
  prefixItems?: Schema[]
  oneOf?: Schema[]
  anyOf?: Schema[]
  allOf?: Schema[]
}

const root = new URL("../..", import.meta.url).pathname
const schema = (await Bun.file(`${root}crates/plugin-abi/schema/v2.json`).json()) as {
  $defs: Record<string, Schema>
  "x-abi": { major: number; minor: number }
}

// Luau's reserved words, which a table type names in brackets.
const reserved = new Set(
  "and break do else elseif end false for function if in local nil not or repeat return then true until while".split(" "),
)

function key(name: string) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && !reserved.has(name) ? name : `[${JSON.stringify(name)}]`
}

function literal(value: string | number | boolean) {
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
    // The HTTP API's types are the OpenAPI document's, which this file does not carry.
    return schema.$ref.startsWith("#/$defs/") ? schema.$ref.slice("#/$defs/".length) : "any"
  }
  if (schema.const !== undefined) return literal(schema.const)
  if (schema.enum) return union(schema.enum.map(literal))
  const alternatives = schema.oneOf ?? schema.anyOf
  if (alternatives) {
    const present = alternatives.filter((alternative) => !nullable(alternative))
    const type = union(present.map((alternative) => luau(alternative, indent)))
    return present.length < alternatives.length ? `${type}?` : type
  }
  if (schema.allOf) return schema.allOf.map((part) => luau(part, indent)).join(" & ")
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
      const required = new Set(schema.required ?? [])
      const inner = indent + "    "
      const fields = Object.entries(schema.properties).map(([name, field]) => {
        const type = luau(field, inner)
        const optional = required.has(name) || type.endsWith("?") ? "" : "?"
        return `${inner}${key(name)}: ${type}${optional},`
      })
      return `{\n${fields.join("\n")}\n${indent}}`
    }
  }
  return "any"
}

function comment(text: string | undefined, indent = "") {
  if (!text) return []
  return text.split("\n").map((line) => `${indent}--- ${line}`)
}

const generated = Object.keys(schema.$defs)
  .toSorted()
  .flatMap((name) => [...comment(schema.$defs[name].description), `export type ${name} = ${luau(schema.$defs[name], "")}`, ""])

// The module and the objects a plugin's calls are handed, as bind.rs binds them.
const api = `-- The plugin's objects -------------------------------------------------------------------------------------------

--- What a render or a view reads; every read of one call sees one store snapshot.
export type Read = {
    themeMode: (self: Read) -> "dark" | "light",
    color: (self: Read, token: string) -> Rgba?,
    storageGet: (self: Read, key: string) -> any,
    session: (self: Read, id: string) -> Session?,
    sessions: (self: Read) -> { Session },
    family: (self: Read, id: string) -> Family,
    messages: (self: Read, id: string) -> { any },
    --- The inbox items of session \`id\` the server has not delivered yet, oldest first; empty while its inbox is not loaded.
    pending: (self: Read, id: string) -> { any },
    --- The models of \`location\`, or where the TUI works; \`nil\` while they are not loaded.
    models: (self: Read, location: LocationRef?) -> { any }?,
    --- The providers where the TUI works; \`nil\` while they are not loaded.
    providers: (self: Read) -> { any }?,
    --- The OpenCode Console workspace's usage limits; \`nil\` while they are not loaded.
    limits: (self: Read) -> any,
    model: (self: Read) -> any,
    info: (self: Read) -> Info,
    route: (self: Read) -> Route,
    interactive: (self: Read) -> boolean,
    shortcut: (self: Read, name: string) -> string?,
    dialogOpen: (self: Read, key: string) -> boolean,
    composer: (self: Read) -> Composer?,
    tabs: (self: Read) -> { Tab },
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
}

--- The version a host serves the plugin: its major, its minor of that major, and its optional features.
export type Abi = { major: number, minor: number, features: { string } }

--- What a handler acts with: the reads, and effects, which wait until the outermost call returns. A render or a view
--- that calls an effect fails.
export type Host = Read & {
    storageSet: (self: Host, key: string, value: { [any]: any }) -> (),
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
    --- A request's ID, or \`nil\` and why the host did not take it; its reply comes to \`setup:onReply\`.
    fetch: (self: Host, fetch: Fetch) -> (number?, string?),
    foreground: (self: Host, program: Foreground) -> (number?, string?),
}

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

--- What setup registers on; each method holds only while setup runs.
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
    onEvent: (self: Setup, types: { string }, run: (host: Host, event: any) -> ()) -> (),
    onReply: (self: Setup, run: (host: Host, id: number, value: any, error: string?) -> ()) -> (),
    onDispose: (self: Setup, run: (host: Host) -> ()) -> (),
    layer: (self: Setup, layer: Layer, handler: (host: Host, event: InputEvent) -> Handled?) -> (),
    surface: (self: Setup, surface: SurfaceSpec, view: (view: View) -> Node, handler: ((host: Host, event: InputEvent) -> Handled?)?) -> (),
}

--- \`require("@opencode/plugin")\`.
export type Plugin = {
    contract: string,
    IMAGE_BOUNDS: string,
    FOCUS_INPUT: string,
    FENCE_NODE: string,
    KEEP: Render,
    HIDE: Render,
    define: (setup: (setup: Setup) -> ()) -> any,
    span: (text: string, style: { [string]: any }?) -> Span,
    text: (content: string | { Span }, props: { [string]: any }?) -> V1Node,
    column: (children: { V1Node }, props: { [string]: any }?) -> V1Node,
    row: (children: { V1Node }, props: { [string]: any }?) -> V1Node,
    show: (node: V1Node) -> Render,
    command: (name: string, input: string?) -> Action,
    click: (name: string, input: string?) -> Click,
}
`

const header = `-- OpenCode plugin contract ${schema["x-abi"].major}.${schema["x-abi"].minor}: the types of a Luau plugin (spike luau-spike).
-- Generated from crates/plugin-abi/schema/v2.json by \`bun run generate\` (script/gen/plugin-types-luau.ts). Do not edit.
-- Load it with \`luau-lsp analyze --definitions=@opencode=crates/plugin/src/luau/opencode.d.luau\`.

-- The contract's definitions ----------------------------------------------------------------------------------------
`

const file = `${root}crates/plugin/src/luau/opencode.d.luau`
await Bun.write(file, `${header}\n${generated.join("\n")}\n${api}`)
console.log(`plugin-types-luau: ${Object.keys(schema.$defs).length} definitions`)
