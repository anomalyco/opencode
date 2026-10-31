// Effect gives shared anonymous schemas encounter-order names (`Union_3`), and does the same for the encoded side of a
// named schema when it differs between uses (`Event.VersionEncoded_37`). Replace those names with a hash of their
// canonical shape and sort components so unrelated additions stay local.
export function stabilizeOpenApi(source: object) {
  const document = source as {
    components: { schemas: Record<string, unknown> }
  }
  const schemas = document.components.schemas
  const reference = (name: string) => `#/components/schemas/${name}`
  const families = ["Union", "Objects", "Arrays"].filter((name) => `${name}_` in schemas)
  const anonymous = new Map(
    Object.keys(schemas)
      .filter(
        (name) => families.some((family) => new RegExp(`^${family}_\\d*$`).test(name)) || /^.+Encoded_\d+$/.test(name),
      )
      .map((name) => [name, schemas[name]]),
  )

  const canonical = (node: unknown, seen = new Set<string>()): unknown => {
    if (Array.isArray(node)) return node.map((item) => canonical(item, seen))
    if (typeof node !== "object" || node === null) return node
    const $ref = "$ref" in node && typeof node.$ref === "string" ? node.$ref : undefined
    const name = $ref?.startsWith(reference("")) ? $ref.slice(reference("").length) : undefined
    if (name !== undefined && anonymous.has(name)) {
      if (seen.has(name)) throw new Error(`Recursive anonymous OpenAPI component: ${name}`)
      return Object.fromEntries([
        ["$ref", canonical(anonymous.get(name), new Set([...seen, name]))],
        ...Object.entries(node)
          .filter(([key]) => key !== "$ref")
          .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
          .map(([key, value]) => [key, canonical(value, seen)]),
      ])
    }
    return Object.fromEntries(
      Object.entries(node)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, value]) => [key, canonical(value, seen)]),
    )
  }
  const renames = new Map(
    [...anonymous].map(([name, schema]) => {
      const hash = new Bun.CryptoHasher("sha256")
        .update(JSON.stringify(canonical(schema)))
        .digest("hex")
        .slice(0, 12)
      return [name, `${name.replace(/_\d*$/, "")}_${hash}`] as const
    }),
  )
  const rewrite = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(rewrite)
    if (typeof node !== "object" || node === null) return node
    return Object.fromEntries(
      Object.entries(node).map(([key, value]) => {
        if (key !== "$ref" || typeof value !== "string" || !value.startsWith(reference(""))) {
          return [key, rewrite(value)]
        }
        const name = value.slice(reference("").length)
        return [key, reference(renames.get(name) ?? name)]
      }),
    )
  }
  const result = rewrite(document) as typeof document
  const stable = new Map<string, unknown>()
  for (const [name, schema] of Object.entries(result.components.schemas)) {
    const target = renames.get(name) ?? name
    const previous = stable.get(target)
    if (previous !== undefined && JSON.stringify(canonical(previous)) !== JSON.stringify(canonical(schema))) {
      throw new Error(`Content-addressed OpenAPI component collision: ${target}`)
    }
    stable.set(target, schema)
  }
  result.components.schemas = Object.fromEntries(
    [...stable].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)),
  )
  return collapseCopies(result)
}

// Effect names a second AST copy of an identified schema `<Name>_<N>`; event streams reach their schemas without the
// JSON codec that REST bodies get. Fold a copy into `<Name>` only when the two are deeply equal, treating a reference
// to another copy as equal to its original only when that copy folds too. Any real difference keeps its own name.
function collapseCopies<Document extends { components: { schemas: Record<string, unknown> } }>(document: Document) {
  const schemas = document.components.schemas
  const prefix = "#/components/schemas/"
  const copies = new Map<string, string>()
  for (const name of Object.keys(schemas)) {
    const original = /^(.+)_\d+$/.exec(name)?.[1]
    if (original !== undefined && Object.hasOwn(schemas, original)) copies.set(name, original)
  }
  const sameReference = (left: string, right: string) => {
    if (left === right) return true
    if (!left.startsWith(prefix) || !right.startsWith(prefix)) return false
    const a = left.slice(prefix.length)
    const b = right.slice(prefix.length)
    return copies.get(a) === b || copies.get(b) === a
  }
  const equal = (left: unknown, right: unknown): boolean => {
    if (Array.isArray(left) || Array.isArray(right)) {
      return (
        Array.isArray(left) &&
        Array.isArray(right) &&
        left.length === right.length &&
        left.every((item, index) => equal(item, right[index]))
      )
    }
    if (typeof left !== "object" || left === null || typeof right !== "object" || right === null) return left === right
    const entries = new Map<string, unknown>(Object.entries(left))
    const others = new Map<string, unknown>(Object.entries(right))
    if (entries.size !== others.size) return false
    return [...entries].every(([key, a]) => {
      if (!others.has(key)) return false
      const b = others.get(key)
      if (key === "$ref" && typeof a === "string" && typeof b === "string") return sameReference(a, b)
      return equal(a, b)
    })
  }
  let changed = true
  while (changed) {
    changed = false
    for (const [copy, original] of copies) {
      if (equal(schemas[copy], schemas[original])) continue
      copies.delete(copy)
      changed = true
    }
  }
  if (copies.size === 0) return document
  const rewrite = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(rewrite)
    if (typeof node !== "object" || node === null) return node
    return Object.fromEntries(
      Object.entries(node).map(([key, value]) => {
        if (key !== "$ref" || typeof value !== "string" || !value.startsWith(prefix)) return [key, rewrite(value)]
        const name = value.slice(prefix.length)
        return [key, `${prefix}${copies.get(name) ?? name}`]
      }),
    )
  }
  const result = rewrite(document) as Document
  result.components.schemas = Object.fromEntries(
    Object.entries(result.components.schemas).filter(([name]) => !copies.has(name)),
  )
  return result
}
