import { OpenApi } from "effect/unstable/httpapi"
import { format } from "prettier"
import { fileURLToPath } from "url"
import { ClientApi } from "../src/client.js"

const document = await format(JSON.stringify(stabilize(OpenApi.fromApi(ClientApi)), null, 2), {
  parser: "json",
  printWidth: 120,
})
const target = fileURLToPath(new URL("../openapi.json", import.meta.url))

if (process.argv.includes("--check")) {
  if ((await Bun.file(target).text()) !== document) {
    console.error("Generated OpenAPI document is stale. Run `bun run generate` from packages/protocol.")
    process.exit(1)
  }
  process.exit(0)
}

await Bun.write(target, document)

// Schema generation names anonymous and colliding components by encounter order (`Union_3`,
// `Form.Fields_1`), so an unrelated schema addition renumbers later components and churns the
// committed document. Inline anonymous components at their use sites, merge identical duplicates
// of identified components into their base name, and sort components so regeneration diffs only
// contain real changes. Genuinely divergent duplicates fail generation instead of renumbering.
function stabilize(source: object) {
  const document = JSON.parse(JSON.stringify(source)) as {
    components: { schemas: Record<string, unknown> }
  }
  const schemas = document.components.schemas
  const reference = (name: string) => `#/components/schemas/${name}`

  const anonymous = new Map(
    Object.keys(schemas)
      .filter((name) => /^(Union|Objects|Arrays)_\d*$/.test(name))
      .map((name) => [reference(name), schemas[name]]),
  )
  const inline = (node: unknown, seen: ReadonlySet<string>): unknown => {
    if (Array.isArray(node)) return node.map((item) => inline(item, seen))
    if (typeof node !== "object" || node === null) return node
    const $ref = "$ref" in node && typeof node.$ref === "string" ? node.$ref : undefined
    if ($ref !== undefined && anonymous.has($ref)) {
      if (seen.has($ref)) throw new Error(`Recursive anonymous OpenAPI component: ${$ref}`)
      return inline(anonymous.get($ref), new Set([...seen, $ref]))
    }
    return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, inline(value, seen)]))
  }
  for (const name of anonymous.keys()) delete schemas[name.slice(reference("").length)]
  document.components.schemas = Object.fromEntries(
    Object.entries(schemas).map(([name, value]) => [name, inline(value, new Set())]),
  ) as Record<string, unknown>
  const inlined = inline(
    Object.fromEntries(Object.entries(document).filter(([key]) => key !== "components")),
    new Set(),
  ) as Record<string, unknown>
  Object.assign(document, inlined)

  const merged = mergeDuplicates(document.components.schemas)
  let rendered = JSON.stringify(document)
  for (const [duplicate, base] of merged) {
    rendered = rendered.replaceAll(JSON.stringify(reference(duplicate)), JSON.stringify(reference(base)))
  }
  const result = JSON.parse(rendered) as typeof document
  result.components.schemas = Object.fromEntries(
    Object.entries(result.components.schemas).sort(([left], [right]) => left.localeCompare(right)),
  )
  const residual = Object.keys(result.components.schemas).filter((name) => /_\d*$/.test(name))
  if (residual.length > 0) {
    throw new Error(`Encounter-order component names survived stabilization: ${residual.join(", ")}`)
  }
  return result
}

// Duplicates may reference other duplicates, so compare with known renames applied and iterate
// to a fixpoint.
function mergeDuplicates(schemas: Record<string, unknown>) {
  const renames = new Map<string, string>()
  const canonical = (name: string) => {
    let value = JSON.stringify(schemas[name])
    for (const [duplicate, base] of renames) {
      value = value.replaceAll(
        JSON.stringify(`#/components/schemas/${duplicate}`),
        JSON.stringify(`#/components/schemas/${base}`),
      )
    }
    return value
  }
  for (let changed = true; changed; ) {
    changed = false
    for (const name of Object.keys(schemas).filter((candidate) => /_\d+$/.test(candidate))) {
      if (renames.has(name)) continue
      const base = name.replace(/_\d+$/, "")
      if (!(base in schemas)) {
        throw new Error(`OpenAPI component ${name} has no base component ${base}; rename its identifier annotation`)
      }
      if (canonical(name) !== canonical(base)) continue
      renames.set(name, base)
      delete schemas[name]
      changed = true
    }
  }
  const conflicting = Object.keys(schemas).filter((name) => /_\d+$/.test(name))
  if (conflicting.length > 0) {
    throw new Error(
      `OpenAPI components collide with different shapes: ${conflicting.join(", ")}; give them distinct identifier annotations`,
    )
  }
  return renames
}
