// Emits one `Client` method per endpoint, following docs/F.2.md.
import type { Endpoint, Group } from "@opencode/httpapi-codegen"
import type { SchemaRepresentation } from "effect"
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
      `/// Input of [\`Client::${name.replace(/^r#/, "")}\`].\n#[derive(Debug, Clone, PartialEq${defaults ? ", Default" : ""})]\npub struct ${input} {\n${lines.map((line) => line.line).join("\n")}\n}`,
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
    types.items.push(`/// Output of [\`Client::${name.replace(/^r#/, "")}\`].\npub type ${outputName} = ${type};`)
    return outputName
  })()

  const path = pathTemplate(method, idents)
  const access = (field: Field) => `input.${idents.get(field)}`
  const statements = method.fields.flatMap((field) => {
    const call =
      field.source === "query"
        ? `call.query(${JSON.stringify(field.name)}, VALUE)?;`
        : field.source === "headers"
          ? `call.header(${JSON.stringify(field.name)}, VALUE)?;`
          : field.source === "payload"
            ? method.binaryBody
              ? `call.bytes(${access(field)}.clone());`
              : method.opaque
                ? "call.json(VALUE)?;"
                : `call.field(${JSON.stringify(field.name)}, VALUE)?;`
            : undefined
    if (call === undefined) return []
    if (field.optional)
      return [`if let Some(value) = &${access(field)} {\n            ${call.replace("VALUE", "value")}\n        }`]
    return [call.replace("VALUE", `&${access(field)}`)]
  })
  if (method.endpoint.payloads.length > 0 && !method.binaryBody && !method.opaque) statements.unshift("call.object();")
  const declared = [...new Set(method.endpoint.errors.map((error) => error.status))]
  const send =
    method.success === "sse"
      ? "self.sse(call, options).await"
      : method.success === "data"
        ? "self.data(call, options).await"
        : method.success === "empty"
          ? "self.empty(call, options).await"
          : method.success === "binary"
            ? "self.binary(call, options).await"
            : "self.json(call, options).await"
  const returns = method.success === "sse" ? `SseResponse<${output}>` : output
  const argument = input === undefined ? "" : `input: &${input}, `
  const mutable = statements.length === 0 ? "" : "mut "
  return `    /// \`${method.endpoint.endpoint.method} ${method.endpoint.endpoint.path}\` (\`${method.endpoint.operation.name}\`)
    pub async fn ${name}(&self, ${argument}options: &RequestOptions) -> Result<${returns}, Error> {
        let ${mutable}call = Call::new(${JSON.stringify(method.endpoint.endpoint.method)}, ${path}, ${method.successStatus}, &[${declared.join(", ")}]);
${statements.map((statement) => `        ${statement}`).join("\n")}
        ${send}
    }`
}

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
      args.push(`crate::client::path_param(&input.${idents.get(field)})?`)
      return "{}"
    })
    .join("")
  if (wildcard !== undefined) args.push(`crate::client::path_wildcard(&input.${idents.get(wildcard)})`)
  if (args.length === 0) return `${JSON.stringify(template)}.to_owned()`
  return `format!(${JSON.stringify(template + (wildcard === undefined ? "" : "{}"))}, ${args.join(", ")})`
}
