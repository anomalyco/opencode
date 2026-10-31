type OpenApiParameter = {
  $ref?: string
  name?: string
  in?: string
  schema?: { $ref?: string } & Record<string, unknown>
} & Record<string, unknown>

type OpenApiOperation = {
  operationId?: string
  parameters?: Array<OpenApiParameter>
} & Record<string, unknown>

type OpenApiDocument = {
  components: {
    schemas: Record<string, unknown>
    parameters?: Record<string, OpenApiParameter>
  }
  paths?: Record<string, Record<string, OpenApiOperation>>
}

const schemaReference = (name: string) => `#/components/schemas/${name}`
const parameterReference = (name: string) => `#/components/parameters/${name}`
const compareKeys = ([left]: readonly [string, unknown], [right]: readonly [string, unknown]) =>
  left < right ? -1 : left > right ? 1 : 0

// Effect gives shared anonymous schemas encounter-order names (`Union_3`) and inlines every
// operation parameter. Replace anonymous schema names with a content hash, extract shared
// parameters into `components.parameters`, and sort components so unrelated additions stay local.
export function stabilizeOpenApi(source: object) {
  const document = source as OpenApiDocument
  const schemas = document.components.schemas
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
    const name = $ref?.startsWith(schemaReference("")) ? $ref.slice(schemaReference("").length) : undefined
    if (name !== undefined && anonymous.has(name)) {
      if (seen.has(name)) throw new Error(`Recursive anonymous OpenAPI component: ${name}`)
      return Object.fromEntries([
        ["$ref", canonical(anonymous.get(name), new Set([...seen, name]))],
        ...Object.entries(node)
          .filter(([key]) => key !== "$ref")
          .sort(compareKeys)
          .map(([key, value]) => [key, canonical(value, seen)]),
      ])
    }
    return Object.fromEntries(
      Object.entries(node)
        .sort(compareKeys)
        .map(([key, value]) => [key, canonical(value, seen)]),
    )
  }
  const digest = (value: unknown) =>
    new Bun.CryptoHasher("sha256")
      .update(JSON.stringify(canonical(value)))
      .digest("hex")
      .slice(0, 12)

  const renames = new Map(
    [...anonymous].map(([name, schema]) => [name, `${name.replace(/_\d*$/, "")}_${digest(schema)}`] as const),
  )
  const rewrite = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(rewrite)
    if (typeof node !== "object" || node === null) return node
    return Object.fromEntries(
      Object.entries(node).map(([key, value]) => {
        if (key !== "$ref" || typeof value !== "string" || !value.startsWith(schemaReference(""))) {
          return [key, rewrite(value)]
        }
        const name = value.slice(schemaReference("").length)
        return [key, schemaReference(renames.get(name) ?? name)]
      }),
    )
  }
  const result = rewrite(document) as OpenApiDocument
  const stable = new Map<string, unknown>()
  for (const [name, schema] of Object.entries(result.components.schemas)) {
    const target = renames.get(name) ?? name
    const previous = stable.get(target)
    if (previous !== undefined && JSON.stringify(canonical(previous)) !== JSON.stringify(canonical(schema))) {
      throw new Error(`Content-addressed OpenAPI component collision: ${target}`)
    }
    stable.set(target, schema)
  }
  result.components.schemas = Object.fromEntries([...stable].sort(compareKeys))
  stabilizeParameters(result, canonical, digest)
  return result
}

type ParameterShape = {
  key: string
  parameter: OpenApiParameter
  count: number
}

function stabilizeParameters(
  document: OpenApiDocument,
  canonical: (node: unknown) => unknown,
  digest: (node: unknown) => string,
) {
  if (!document.paths) return
  const byShape = new Map<string, ParameterShape>()

  for (const item of Object.values(document.paths)) {
    for (const operation of Object.values(item)) {
      if (!operation || typeof operation !== "object" || !Array.isArray(operation.parameters)) continue
      for (const parameter of operation.parameters) {
        if ("$ref" in parameter || !parameter.in || !parameter.name) continue
        const key = JSON.stringify(canonical(parameter))
        const existing = byShape.get(key)
        byShape.set(key, {
          key,
          parameter: existing?.parameter ?? parameter,
          count: (existing?.count ?? 0) + 1,
        })
      }
    }
  }

  const extracted = [...byShape.values()].filter((shape) => shape.count >= 2)
  if (extracted.length === 0) return

  const byCandidate = new Map<string, Array<ParameterShape>>()
  for (const shape of extracted) {
    const candidate = qualifyParameterName(`${shape.parameter.in}.${shape.parameter.name}`, shape.parameter)
    byCandidate.set(candidate, [...(byCandidate.get(candidate) ?? []), shape])
  }

  const nameByKey = new Map<string, string>()
  const parameters = new Map<string, OpenApiParameter>(Object.entries(document.components.parameters ?? {}))
  for (const [candidate, shapes] of byCandidate) {
    for (const shape of shapes) {
      const name = shapes.length === 1 && !parameters.has(candidate) ? candidate : `${candidate}_${digest(shape.parameter)}`
      nameByKey.set(shape.key, name)
      parameters.set(name, shape.parameter)
    }
  }

  for (const item of Object.values(document.paths)) {
    for (const operation of Object.values(item)) {
      if (!operation || typeof operation !== "object" || !Array.isArray(operation.parameters)) continue
      operation.parameters = operation.parameters.map((parameter) => {
        if ("$ref" in parameter) return parameter
        const name = nameByKey.get(JSON.stringify(canonical(parameter)))
        return name ? { $ref: parameterReference(name) } : parameter
      })
    }
  }

  document.components.parameters = Object.fromEntries([...parameters].sort(compareKeys))
}

function qualifyParameterName(base: string, parameter: OpenApiParameter) {
  const ref = parameter.schema?.$ref
  if (typeof ref === "string" && ref.startsWith(schemaReference(""))) {
    return `${base}.${ref.slice(schemaReference("").length)}`
  }
  return base
}
