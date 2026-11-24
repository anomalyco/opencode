// Emits, per endpoint: the request builder in `opencode-api-types` (`client::<name>`, typed by
// its output, with no transport), the `Client` method that sends it, the endpoint's row of the operations table the
// Luau prelude's `plugin.client` builds requests from, and a probe that builds the request from JSON, for the table
// test (`typed-client`).
import type { Endpoint, Group } from "@opencode/httpapi-codegen"
import type { SchemaRepresentation } from "effect"
import { example, luauType } from "./example.ts"
import { pascal, snake, type Types } from "./types.ts"

export type Field = {
  readonly name: string
  readonly source: "params" | "query" | "headers" | "payload" | "wildcard"
  readonly optional: boolean
  /** Undefined for the wildcard, which is always a string. */
  readonly representation: SchemaRepresentation.Representation | undefined
}

export type Method = {
  readonly group: Group
  readonly endpoint: Endpoint
  readonly prefix: string
  readonly fields: ReadonlyArray<Field>
  readonly opaque: boolean
  readonly binaryBody: boolean
  readonly success: "json" | "data" | "empty" | "binary" | "sse"
  readonly output: SchemaRepresentation.Representation | undefined
  readonly successStatus: number
}

/** A row of the operations table: what the Luau prelude needs to build the request (`crates/plugin/src/luau`). */
export type Operation = {
  readonly method: string
  readonly path: string
  /**
   * Each input field: its name, where it goes, whether it may be left out, and the Luau type of a path, query or header
   * field (`null` for a payload field, which the Luau stub types from the OpenAPI document).
   */
  readonly fields: ReadonlyArray<readonly [string, Field["source"], boolean, string | null]>
  /** `object`: the payload fields make an object; `json`: the payload field is the body; `bytes`: a byte body. */
  readonly body: "object" | "json" | "bytes" | null
  readonly reply: Method["success"]
}

export function emitMethod(types: Types, method: Method) {
  const name = snake(
    [...method.group.path, ...method.endpoint.clientPath].map((part) => snake(part).replace(/^r#/, "")).join("_"),
  )
  const idents = new Map<Field, string>()
  for (const field of method.fields) {
    let ident = snake(field.name)
    for (let i = 2; [...idents.values()].includes(ident); i++) ident = `${snake(field.name)}_${i}`
    idents.set(field, ident)
  }
  const input = method.fields.length === 0 ? undefined : types.name(`${method.prefix}Input`)
  if (input !== undefined) {
    const lines = method.fields.map((field) => {
      // Every endpoint shares the `location` query shape; name it for what it is, not for the first endpoint.
      const hint =
        field.source === "query" && field.name === "location"
          ? "LocationQueryInput"
          : `${method.prefix}Input${pascal(field.name)}`
      const type =
        method.binaryBody && field.source === "payload"
          ? "bytes::Bytes"
          : field.representation === undefined
            ? "String"
            : (types.field(field.representation, field.optional, hint)?.type ?? "()")
      return { line: `    pub ${idents.get(field)}: ${type},`, type }
    })
    const defaults = lines.every((line) => types.isDefault(line.type) || line.type === "bytes::Bytes")
    types.items.push(
      `/// Input of \`Client::${name.replace(/^r#/, "")}\`.\n#[derive(Debug, Clone, PartialEq${defaults ? ", Default" : ""})]\npub struct ${input} {\n${lines.map((line) => line.line).join("\n")}\n}`,
    )
  }
  const outputName = types.name(`${method.prefix}Output`)
  const output = (() => {
    if (method.success === "empty") return "()"
    if (method.success === "binary") return "bytes::Bytes"
    const representation = method.output!
    if (representation._tag === "Objects" && representation.propertySignatures.length > 0) {
      return types.objects(representation, outputName, outputName)
    }
    const type = types.type(representation, outputName)
    types.items.push(`/// Output of \`Client::${name.replace(/^r#/, "")}\`.\npub type ${outputName} = ${type};`)
    return outputName
  })()

  const path = pathTemplate(method, idents)
  const access = (field: Field) => `input.${idents.get(field)}`
  const statements = method.fields.flatMap((field) => {
    const call =
      field.source === "query"
        ? `call.query(${JSON.stringify(field.name)}, VALUE);`
        : field.source === "headers"
          ? `call.header(${JSON.stringify(field.name)}, VALUE);`
          : field.source === "payload"
            ? method.binaryBody
              ? `call.bytes(${access(field)}.clone());`
              : method.opaque
                ? "call.json(VALUE);"
                : `call.field(${JSON.stringify(field.name)}, VALUE);`
            : undefined
    if (call === undefined) return []
    if (field.optional)
      return [`if let Some(value) = &${access(field)} {\n        ${call.replace("VALUE", "value")}\n    }`]
    return [call.replace("VALUE", `&${access(field)}`)]
  })
  if (method.endpoint.payloads.length > 0 && !method.binaryBody && !method.opaque) statements.unshift("call.object();")
  const declared = [...new Set(method.endpoint.errors.map((error) => error.status))]
  const reply = { json: "Json", data: "Data", empty: "Empty", binary: "Binary", sse: "Sse" }[method.success]
  const typed = method.success === "sse" ? `Sse<${output}>` : output
  const parameter = input === undefined ? "" : `input: &${input}`
  const builder = `${name.replace(/^r#/, "")}_call`
  const start = `Call::new(${JSON.stringify(method.endpoint.endpoint.method)}, ${path.literal ?? "String::new()"}, Reply::${reply}, ${method.successStatus}, &[${declared.join(", ")}])`
  const lines = [...(path.literal === undefined ? [`call.path = ${path.format};`] : []), ...statements]
  const body =
    lines.length === 0
      ? `    ${start}`
      : [`let mut call = ${start};`, ...lines, "call"].map((line) => `    ${line}`).join("\n")
  const returns = method.success === "sse" ? `SseResponse<${output}>` : output
  const doc = `/// \`${method.endpoint.endpoint.method} ${method.endpoint.endpoint.path}\` (\`${method.endpoint.operation.name}\`)`
  const operation = [...method.group.path, ...method.endpoint.clientPath].join(".")

  // The probe reads each field from JSON by its wire name; a byte body has no JSON form.
  const probe = method.binaryBody
    ? `${JSON.stringify(operation)} => Some(Err("a byte body".to_owned())),`
    : `${JSON.stringify(operation)} => Some((|| Ok(${name}(${
        input === undefined
          ? ""
          : `&${input} { ${method.fields.map((field) => `${idents.get(field)}: field(input, ${JSON.stringify(field.name)})?`).join(", ")} }`
      }).cast()))()),`
  return {
    /** The `Client` method and its untyped builder, which delegates to the typed one. */
    method: `    endpoint!(${JSON.stringify(doc.slice(3))}, ${name}, ${builder}, ${method.success}, ${returns}${input === undefined ? "" : `, input: ${input}`});`,
    builder: `${doc}\npub fn ${name}(${parameter}) -> Call<${typed}> {\n${body}\n}`,
    probe,
    name: operation,
    operation: {
      method: method.endpoint.endpoint.method,
      path: method.endpoint.endpoint.path,
      fields: method.fields.map(
        (field) =>
          [
            field.name,
            field.source,
            field.optional,
            field.source === "payload"
              ? null
              : field.representation === undefined
                ? "string"
                : luauType(types, field.representation),
          ] as const,
      ),
      body: method.binaryBody
        ? "bytes"
        : method.opaque
          ? "json"
          : method.endpoint.payloads.length > 0
            ? "object"
            : null,
      reply: method.success,
    } satisfies Operation,
    sample: Object.fromEntries(
      method.fields.flatMap((field) => {
        if (field.source === "wildcard") return [[field.name, "a/b c"]]
        if (method.binaryBody && field.source === "payload") return []
        const value = field.representation === undefined ? "s" : example(types, field.representation)
        return value === undefined ? [] : [[field.name, value]]
      }),
    ),
  }
}

/** The path with its parameters: a literal when it has none, else the `format!` that fills them. */
function pathTemplate(method: Method, idents: Map<Field, string>) {
  const params = new Map(method.fields.filter((field) => field.source === "params").map((field) => [field.name, field]))
  const wildcard = method.fields.find((field) => field.source === "wildcard")
  const source = wildcard === undefined ? method.endpoint.endpoint.path : method.endpoint.endpoint.path.slice(0, -1)
  const args: Array<string> = []
  const template = source
    .split(/(:[A-Za-z_][A-Za-z0-9_]*)/g)
    .filter(Boolean)
    .map((segment) => {
      if (!segment.startsWith(":")) return segment.replaceAll("{", "{{").replaceAll("}", "}}")
      const field = params.get(segment.slice(1))
      if (field === undefined) throw new Error(`Missing path parameter: ${segment}`)
      args.push(`call.param(&input.${idents.get(field)})`)
      return "{}"
    })
    .join("")
  if (wildcard !== undefined) args.push(`path_wildcard(&input.${idents.get(wildcard)})`)
  if (args.length === 0) return { literal: `${JSON.stringify(template)}.to_owned()`, format: undefined }
  return {
    literal: undefined,
    format: `format!(${JSON.stringify(template + (wildcard === undefined ? "" : "{}"))}, ${args.join(", ")})`,
  }
}
