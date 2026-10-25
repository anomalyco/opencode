// Effect gives shared anonymous schemas encounter-order names (`Union_3`). Replace those names
// with a hash of their canonical shape and sort components so unrelated additions stay local.
export function stabilizeOpenApi(source: object) {
  const document = source as {
    components: { schemas: Record<string, unknown> }
  }
  const schemas = document.components.schemas
  const reference = (name: string) => `#/components/schemas/${name}`
  const families = ["Union", "Objects", "Arrays"].filter((name) => `${name}_` in schemas)
  const anonymous = new Map(
    Object.keys(schemas)
      .filter((name) => families.some((family) => new RegExp(`^${family}_\\d*$`).test(name)))
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
  return result
}
