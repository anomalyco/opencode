type Document = { components: { schemas: Record<string, unknown> } }

const prefix = "#/components/schemas/"
const byKey = ([left]: [string, unknown], [right]: [string, unknown]) => (left < right ? -1 : left > right ? 1 : 0)
const refName = (value: unknown) =>
  typeof value === "string" && value.startsWith(prefix) ? value.slice(prefix.length) : undefined

const renameRefs = (node: unknown, rename: (name: string) => string): unknown => {
  if (Array.isArray(node)) return node.map((item) => renameRefs(item, rename))
  if (typeof node !== "object" || node === null) return node
  return Object.fromEntries(
    Object.entries(node).map(([key, value]) => {
      const name = key === "$ref" ? refName(value) : undefined
      return [key, name === undefined ? renameRefs(value, rename) : prefix + rename(name)]
    }),
  )
}

// Sorted keys, with references to `inline` components replaced by their canonical content.
const canonical = (
  node: unknown,
  inline: ReadonlyMap<string, unknown> = new Map(),
  seen = new Set<string>(),
): unknown => {
  if (Array.isArray(node)) return node.map((item) => canonical(item, inline, seen))
  if (typeof node !== "object" || node === null) return node
  return Object.fromEntries(
    Object.entries(node)
      .sort(byKey)
      .map(([key, value]) => {
        const name = key === "$ref" ? refName(value) : undefined
        if (name === undefined || !inline.has(name)) return [key, canonical(value, inline, seen)]
        if (seen.has(name)) throw new Error(`Recursive anonymous OpenAPI component: ${name}`)
        return [key, canonical(inline.get(name), inline, new Set([...seen, name]))]
      }),
  )
}
const shape = (node: unknown, inline?: ReadonlyMap<string, unknown>) => JSON.stringify(canonical(node, inline))

// Effect gives shared anonymous schemas encounter-order names (`Union_3`), and does the same for the encoded side of a
// named schema when it differs between uses (`Event.VersionEncoded_37`). Replace those names with a hash of their
// canonical shape and sort components so unrelated additions stay local.
export function stabilizeOpenApi(source: object) {
  const schemas = (source as Document).components.schemas
  const families = ["Union_", "Objects_", "Arrays_"].filter((name) => name in schemas)
  const encoded = new Set(Object.keys(schemas).flatMap((name) => /^(.+Encoded)_\d+$/.exec(name)?.[1] ?? []))
  const anonymous = new Map(
    Object.entries(schemas).filter(
      ([name]) => families.includes(name.replace(/\d+$/, "")) || encoded.has(name.replace(/_\d+$/, "")),
    ),
  )
  const renames = new Map(
    [...anonymous].map(([name, schema]) => {
      const hash = new Bun.CryptoHasher("sha256").update(shape(schema, anonymous)).digest("hex").slice(0, 12)
      return [name, `${name.replace(/_\d*$/, "")}_${hash}`] as const
    }),
  )
  const result = renameRefs(source, (name) => renames.get(name) ?? name) as Document
  const stable = new Map<string, unknown>()
  for (const [name, schema] of Object.entries(result.components.schemas)) {
    const target = renames.get(name) ?? name
    const previous = stable.get(target)
    if (previous !== undefined && shape(previous) !== shape(schema)) {
      throw new Error(`Content-addressed OpenAPI component collision: ${target}`)
    }
    stable.set(target, schema)
  }
  result.components.schemas = Object.fromEntries([...stable].sort(byKey))
  return collapseCopies(result)
}

// Effect names a second AST copy of an identified schema `<Name>_<N>`; event streams reach their schemas without the
// JSON codec that REST bodies get. Fold a copy into `<Name>` only when the two are deeply equal, treating a reference
// to a copy as a reference to its original only while that copy still folds. Any real difference keeps its own name.
function collapseCopies(document: Document) {
  const schemas = document.components.schemas
  const copies = new Map<string, string>()
  for (const name of Object.keys(schemas)) {
    const original = /^(.+)_\d+$/.exec(name)?.[1]
    if (original !== undefined && Object.hasOwn(schemas, original)) copies.set(name, original)
  }
  const resolve = (name: string): string => {
    const original = copies.get(name)
    return original === undefined ? name : resolve(original)
  }
  const folded = (name: string) => shape(renameRefs(schemas[name], resolve))
  let changed = true
  while (changed) {
    changed = false
    for (const [copy, original] of copies) {
      if (folded(copy) === folded(original)) continue
      copies.delete(copy)
      changed = true
    }
  }
  if (copies.size === 0) return document
  const result = renameRefs(document, resolve) as Document
  result.components.schemas = Object.fromEntries(
    Object.entries(result.components.schemas).filter(([name]) => !copies.has(name)),
  )
  return result
}
