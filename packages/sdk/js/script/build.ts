#!/usr/bin/env bun
import { fileURLToPath } from "url"

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

import { $ } from "bun"
import path from "path"

import { createClient } from "@hey-api/openapi-ts"

const opencode = path.resolve(dir, "../../opencode")
const client = path.resolve(dir, "../../client")

await $`bun dev generate > ${dir}/openapi.json`.cwd(opencode)
await $`bun -e ${`
  import { OpenApi } from "effect/unstable/httpapi"
  import { ClientApi } from "@opencode-ai/protocol/client"

  const output = process.argv.at(-1)
  if (!output) throw new Error("Missing OpenAPI output path")
  await Bun.write(output, JSON.stringify(OpenApi.fromApi(ClientApi)))
`} ${path.join(dir, "openapi-v2.json")}`.cwd(client)

type OpenApiDocument = {
  components?: { schemas?: Record<string, unknown> }
  paths?: Record<string, unknown>
  [key: string]: unknown
}

const document = (await Bun.file("./openapi.json").json()) as OpenApiDocument
const v2Document = (await Bun.file("./openapi-v2.json").json()) as OpenApiDocument
normalizeComponentNames(v2Document)
deduplicateEquivalentComponent(v2Document, "Shell", "Shell1")
renameCollidingComponents(document, v2Document)
document.paths = { ...document.paths, ...v2Document.paths }
document.components = {
  ...document.components,
  schemas: { ...document.components?.schemas, ...v2Document.components?.schemas },
}
inlineTypedAllOfConstraints(document)
const schemas = document.components?.schemas
if (schemas) {
  const reachable = new Set<string>()
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(visit)
      return
    }
    if (typeof value !== "object" || value === null) return
    for (const [key, child] of Object.entries(value)) {
      if (key === "$ref" && typeof child === "string" && child.startsWith("#/components/schemas/")) {
        const name = child.slice("#/components/schemas/".length)
        if (reachable.has(name)) continue
        reachable.add(name)
        visit(schemas[name])
      } else {
        visit(child)
      }
    }
  }
  visit({ ...document, components: { ...document.components, schemas: undefined } })
  for (const name of Object.keys(schemas)) {
    if (
      /^(SessionAgentSelected|SessionModelSelected|SessionMoved|SessionRenamed|SessionForked|SessionPromptPromoted|SessionPromptAdmitted|SessionExecutionStarted|SessionExecutionSucceeded|SessionExecutionFailed|SessionExecutionInterrupted|SessionInstructionsUpdated|SessionSynthetic|SessionSkillActivated|SessionShellStarted|SessionShellEnded|SessionStepStarted|SessionStepEnded|SessionStepFailed|SessionTextStarted|SessionTextDelta|SessionTextEnded|SessionToolInputStarted|SessionToolInputDelta|SessionToolInputEnded|SessionToolCalled|SessionToolProgress|SessionToolSuccess|SessionToolFailed|SessionRetryScheduled|SessionCompactionStarted|SessionCompactionDelta|SessionCompactionEnded|SessionRevertStaged|SessionRevertCleared|SessionRevertCommitted)\d+$/.test(
        name,
      ) &&
      !reachable.has(name)
    )
      delete schemas[name]
  }
  await Bun.write("./openapi.json", JSON.stringify(document))
}

await createClient({
  input: "./openapi.json",
  output: {
    path: "./src/v2/gen",
    tsConfigPath: path.join(dir, "tsconfig.json"),
    clean: true,
  },
  plugins: [
    {
      name: "@hey-api/typescript",
      exportFromIndex: false,
    },
    {
      name: "@hey-api/sdk",
      instance: "OpencodeClient",
      exportFromIndex: false,
      auth: false,
      paramsStructure: "flat",
    },
    {
      name: "@hey-api/client-fetch",
      exportFromIndex: false,
      baseUrl: "http://localhost:4096",
    },
  ],
})

const generatedTypesPath = "./src/v2/gen/types.gen.ts"
const generatedTypes = await Bun.file(generatedTypesPath).text()
if (
  /export type (SessionAgentSelected|SessionModelSelected|SessionMoved|SessionRenamed|SessionForked|SessionPromptPromoted|SessionPromptAdmitted|SessionExecutionStarted|SessionExecutionSucceeded|SessionExecutionFailed|SessionExecutionInterrupted|SessionInstructionsUpdated|SessionSynthetic|SessionSkillActivated|SessionShellStarted|SessionShellEnded|SessionStepStarted|SessionStepEnded|SessionStepFailed|SessionTextStarted|SessionTextDelta|SessionTextEnded|SessionToolInputStarted|SessionToolInputDelta|SessionToolInputEnded|SessionToolCalled|SessionToolProgress|SessionToolSuccess|SessionToolFailed|SessionRetryScheduled|SessionCompactionStarted|SessionCompactionDelta|SessionCompactionEnded|SessionRevertStaged|SessionRevertCleared|SessionRevertCommitted)\d+ =/.test(
    generatedTypes,
  )
) {
  throw new Error("Session history generated duplicate Session event variants")
}
const sessionErrorTypesPatched = deduplicateEquivalentGeneratedTypes(
  generatedTypes,
  "SessionStructuredError",
  /^SessionStructuredError\d+$/,
)
const obsoleteSessionNext = [...sessionErrorTypesPatched.matchAll(/export type (SessionNext\w*) =/g)].map(
  (match) => match[1],
)
if (obsoleteSessionNext.length > 0) {
  throw new Error(`Obsolete SessionNext generated type noise reintroduced: ${obsoleteSessionNext.join(", ")}`)
}
const logTypesPatched = sessionErrorTypesPatched.replace(
  /(export type V2SessionLogData = \{[\s\S]*?query\?: \{\s*after\?: )string/,
  "$1number",
)
if (logTypesPatched === sessionErrorTypesPatched) {
  throw new Error("Session log numeric query patch did not apply")
}
const sessionListTypesPatched = logTypesPatched.replace(
  /(export type V2SessionListData = \{[\s\S]*?query\?: \{[\s\S]*?limit\?: )string( \| null)/,
  "$1number$2",
)
if (sessionListTypesPatched === logTypesPatched) {
  throw new Error("Session list numeric query patch did not apply")
}
const sessionMessagesTypesPatched = sessionListTypesPatched.replace(
  /(export type V2MessageListData = \{[\s\S]*?query\?: \{[\s\S]*?limit\?: )string( \| null)/,
  "$1number$2",
)
if (sessionMessagesTypesPatched === sessionListTypesPatched) {
  throw new Error("Session messages numeric query patch did not apply")
}
const eventSubscribeTypesPatched = sessionMessagesTypesPatched.replace(
  /(export type V2EventSubscribeResponses = \{\s*\/\*\*[\s\S]*?\*\/\s*200: )\{\s*id: string \| null;?\s*event: string;?\s*data: V2EventStream(?:V2)?;?\s*\};?/,
  "$1V2Event",
)
if (eventSubscribeTypesPatched === sessionMessagesTypesPatched) {
  throw new Error("Event subscribe response patch did not apply")
}
if (/SessionStructuredError\d/.test(eventSubscribeTypesPatched)) {
  throw new Error("Session structured error generated a name-mangled duplicate")
}
if (/\bSessionNext\w*\b/.test(eventSubscribeTypesPatched)) {
  throw new Error("Obsolete SessionNext generated type noise reintroduced")
}
if (/export type Shell\d+V2 =/.test(eventSubscribeTypesPatched)) {
  throw new Error("Shell generated a name-mangled duplicate")
}
await Bun.write(generatedTypesPath, eventSubscribeTypesPatched)

const querySerializerPath = "./src/v2/gen/client/utils.gen.ts"
const querySerializerSource = await Bun.file(querySerializerPath).text()
const querySerializerPatched = querySerializerSource.replace(
  /if \(value === undefined \|\| value === null\) \{\s*continue;?\s*\}/,
  "if (value === undefined) {\n          continue;\n        }\n\n        if (value === null) {\n          search.push(`${name}=null`);\n          continue;\n        }",
)
if (querySerializerPatched === querySerializerSource) {
  throw new Error(
    `Query serializer null patch did not apply; @hey-api/openapi-ts output may have changed (${querySerializerPath})`,
  )
}
await Bun.write(querySerializerPath, querySerializerPatched)

const generatedSdkPath = "./src/v2/gen/sdk.gen.ts"
const generatedSdk = await Bun.file(generatedSdkPath).text()
const logSdkPatched = generatedSdk.replace(
  /(Read the session log[\s\S]*?parameters: \{[\s\S]*?after\?: )string(\s*\|\s*null)?/,
  "$1number$2",
)
if (logSdkPatched === generatedSdk) {
  throw new Error("Session log numeric SDK patch did not apply")
}
const sessionListSdkPatched = logSdkPatched.replace(
  /(List sessions[\s\S]*?parameters\?: \{[\s\S]*?limit\?: )string( \| null)/,
  "$1number$2",
)
if (sessionListSdkPatched === logSdkPatched) {
  throw new Error("Session list numeric SDK patch did not apply")
}
const sessionMessagesSdkPatched = sessionListSdkPatched.replace(
  /(Get session messages[\s\S]*?parameters: \{[\s\S]*?limit\?: )string( \| null)/,
  "$1number$2",
)
if (sessionMessagesSdkPatched === sessionListSdkPatched) {
  throw new Error("Session messages numeric SDK patch did not apply")
}
await Bun.write(generatedSdkPath, sessionMessagesSdkPatched)

// Patch a @hey-api/openapi-ts codegen bug: SseFn incorrectly passes the
// endpoint's TError into the second generic of ServerSentEventsResult, which
// is the AsyncGenerator's TReturn slot. Iterator return values have nothing
// to do with HTTP errors, and any consumer that calls `.return()` or returns
// from a mock generator gets type-checked against the wrong shape. Drop the
// arg so TReturn defaults to void.
const sseTypesPath = "./src/v2/gen/client/types.gen.ts"
const sseTypesFile = Bun.file(sseTypesPath)
const sseTypesSource = await sseTypesFile.text()
const sseTypesPatched = sseTypesSource.replace(
  "=> Promise<ServerSentEventsResult<TData, TError>>",
  "=> Promise<ServerSentEventsResult<TData>>",
)
if (sseTypesPatched === sseTypesSource) {
  throw new Error(`SseFn patch did not apply; @hey-api/openapi-ts output may have changed (${sseTypesPath})`)
}
await Bun.write(sseTypesPath, sseTypesPatched)

await $`bun prettier --write src/gen`
await $`bun prettier --write src/v2`
await $`rm -rf dist`
await $`bun tsc`
await $`rm openapi.json openapi-v2.json`

function renameCollidingComponents(target: OpenApiDocument, source: OpenApiDocument) {
  const targetSchemas = target.components?.schemas
  const sourceSchemas = source.components?.schemas
  if (!targetSchemas || !sourceSchemas) return

  const renames = new Map<string, string>()
  for (const name of Object.keys(sourceSchemas)) {
    if (!Object.hasOwn(targetSchemas, name)) continue
    if (JSON.stringify(normalizeSchema(sourceSchemas[name])) === JSON.stringify(normalizeSchema(targetSchemas[name]))) {
      delete sourceSchemas[name]
      continue
    }
    let renamed = `${name}V2`
    let index = 2
    while (Object.hasOwn(targetSchemas, renamed) || Object.hasOwn(sourceSchemas, renamed)) {
      renamed = `${name}V2${index}`
      index++
    }
    renames.set(name, renamed)
  }
  if (renames.size === 0) return

  source.components = {
    ...source.components,
    schemas: Object.fromEntries(
      Object.entries(sourceSchemas).map(([name, schema]) => [renames.get(name) ?? name, rewriteRefs(schema, renames)]),
    ),
  }
  source.paths = rewriteRefs(source.paths, renames) as Record<string, unknown> | undefined
}

function normalizeComponentNames(document: OpenApiDocument) {
  const schemas = document.components?.schemas
  if (!schemas) return

  const canonical = new Map(Object.entries(schemas))
  const renames = new Map<string, string>()
  for (const name of Object.keys(schemas)) {
    const next = componentTypeName(name)
    if (next === name) continue
    const existing = canonical.get(next)
    if (existing !== undefined) {
      if (JSON.stringify(normalizeSchema(schemas[name])) !== JSON.stringify(normalizeSchema(existing))) continue
      renames.set(name, next)
      continue
    }
    renames.set(name, next)
    canonical.set(next, schemas[name])
  }
  if (renames.size === 0) return

  const renamed = new Set<string>()
  document.components = {
    ...document.components,
    schemas: Object.fromEntries(
      [
        ...Object.entries(schemas).filter(([name]) => !renames.has(name)),
        ...Object.entries(schemas).flatMap(([name, schema]) => {
          const next = renames.get(name)
          if (!next || Object.hasOwn(schemas, next) || renamed.has(next)) return []
          renamed.add(next)
          return [[next, schema] as const]
        }),
      ].map(([name, schema]) => [name, rewriteRefs(schema, renames)]),
    ),
  }
  document.paths = rewriteRefs(document.paths, renames) as Record<string, unknown> | undefined
}

function componentTypeName(name: string) {
  if (!name.includes(".")) return name
  return name
    .split(".")
    .filter((part) => !/^\d+$/.test(part))
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join("")
}

function deduplicateEquivalentComponent(document: OpenApiDocument, canonical: string, duplicate: string) {
  const schemas = document.components?.schemas
  if (!schemas?.[canonical] || !schemas[duplicate]) return
  if (JSON.stringify(normalizeSchema(schemas[canonical])) !== JSON.stringify(normalizeSchema(schemas[duplicate]))) {
    throw new Error(`${duplicate} no longer has the same wire shape as ${canonical}`)
  }

  const renames = new Map([[duplicate, canonical]])
  const rewritten = rewriteRefs(schemas, renames) as Record<string, unknown>
  delete rewritten[duplicate]
  document.components = { ...document.components, schemas: rewritten }
  document.paths = rewriteRefs(document.paths, renames) as Record<string, unknown> | undefined
}

function deduplicateEquivalentGeneratedTypes(source: string, canonical: string, duplicates: RegExp) {
  const canonicalType = generatedType(source, canonical)
  if (!canonicalType) throw new Error(`Generated canonical type missing: ${canonical}`)
  const names = [...source.matchAll(/export type (\w+) =/g)]
    .map((match) => match[1])
    .filter((name): name is string => name !== undefined && duplicates.test(name))

  return names.reduce((patched, name) => {
    const duplicate = generatedType(patched, name)
    const currentCanonical = generatedType(patched, canonical)
    if (!duplicate || !currentCanonical) throw new Error(`Generated type declaration missing while comparing ${name}`)
    if (normalizeGeneratedType(currentCanonical.shape) !== normalizeGeneratedType(duplicate.shape)) {
      throw new Error(`${name} no longer has the same generated type shape as ${canonical}`)
    }
    return (patched.slice(0, duplicate.start) + patched.slice(duplicate.end)).replaceAll(name, canonical)
  }, source)
}

function generatedType(source: string, name: string) {
  const start = source.indexOf(`export type ${name} =`)
  if (start === -1) return undefined
  const next = source.indexOf("\n\nexport type ", start + 1)
  const shapeEnd = next === -1 ? source.length : next
  return {
    start,
    end: next === -1 ? source.length : next + 2,
    shape: source.slice(source.indexOf("=", start) + 1, shapeEnd),
  }
}

function normalizeGeneratedType(shape: string) {
  return shape.replaceAll(/\s/g, "")
}

function normalizeSchema(value: unknown, key?: string): unknown {
  if (Array.isArray(value)) {
    const flattened =
      key === "anyOf"
        ? value.flatMap((item) =>
            typeof item === "object" && item !== null && Object.keys(item).length === 1 && "anyOf" in item
              ? Array.isArray(item.anyOf)
                ? item.anyOf
                : [item]
              : [item],
          )
        : value
    const expanded =
      key === "anyOf"
        ? flattened.flatMap((item) => {
            if (typeof item !== "object" || item === null || !("type" in item) || !("enum" in item)) return [item]
            if (Object.keys(item).some((property) => property !== "type" && property !== "enum")) return [item]
            if (!Array.isArray(item.enum)) return [item]
            return item.enum.map((member) => ({ type: item.type, enum: [member] }))
          })
        : flattened
    const normalized = expanded.map((item) => normalizeSchema(item))
    if (key !== "anyOf" && key !== "required" && key !== "enum") return normalized
    return [...new Map(normalized.map((item) => [JSON.stringify(item), item])).values()].sort((a, b) =>
      JSON.stringify(a).localeCompare(JSON.stringify(b)),
    )
  }
  if (typeof value !== "object" || value === null) return value
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([property, child]) => [property, normalizeSchema(child, property)]),
  )
}

function rewriteRefs(value: unknown, renames: Map<string, string>): unknown {
  if (Array.isArray(value)) return value.map((item) => rewriteRefs(item, renames))
  if (typeof value !== "object" || value === null) return value

  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => {
      if (key !== "$ref" || typeof child !== "string") return [key, rewriteRefs(child, renames)]
      const prefix = "#/components/schemas/"
      if (!child.startsWith(prefix)) return [key, child]
      return [key, `${prefix}${renames.get(child.slice(prefix.length)) ?? child.slice(prefix.length)}`]
    }),
  )
}

function inlineTypedAllOfConstraints(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(inlineTypedAllOfConstraints)
    return
  }
  if (typeof value !== "object" || value === null) return

  const schema = value as { allOf?: unknown; type?: unknown; [key: string]: unknown }
  if (typeof schema.type === "string" && Array.isArray(schema.allOf) && schema.allOf.every(isConstraintSchema)) {
    for (const item of schema.allOf) Object.assign(schema, item)
    delete schema.allOf
  }
  Object.values(schema).forEach(inlineTypedAllOfConstraints)
}

function isConstraintSchema(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false
  return !Object.keys(value).some(
    (key) => key === "$ref" || key === "type" || key === "allOf" || key === "anyOf" || key === "oneOf",
  )
}
