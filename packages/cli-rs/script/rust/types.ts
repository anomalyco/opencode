// Emits Rust types from Effect schema representations, following docs/F.2.md.
import type { SchemaRepresentation } from "effect"

type R = SchemaRepresentation.Representation
type Objects = SchemaRepresentation.Objects

const keywords = new Set(
  "as async await break const continue crate dyn else enum extern false fn for gen if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while abstract become box do final macro override priv try typeof unsized virtual yield".split(
    " ",
  ),
)

export function pascal(value: string) {
  const name = value
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => `${part[0].toUpperCase()}${part.slice(1)}`)
    .join("")
  return /^[A-Za-z]/.test(name) ? name : `V${name}`
}

export function snake(value: string) {
  const name = value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .join("_")
    .toLowerCase()
  const safe = /^[a-z_]/.test(name) ? name : `v${name}`
  if (safe === "self" || safe === "super" || safe === "crate" || safe === "_") return `${safe}_`
  return keywords.has(safe) ? `r#${safe}` : safe
}

/** Turns representations into Rust items. `type(r, hint)` returns a Rust type expression and emits what it names. */
export class Types {
  readonly items: Array<string> = []
  private readonly names = new Set<string>()
  private readonly referenced = new Map<string, string>()
  private readonly defaultable = new Set<string>()
  private readonly visiting = new Set<string>()
  // Anonymous objects and unions by shape, so equal shapes (such as every `location` query) share one type.
  private readonly shapes = new Map<string, string>()

  constructor(private readonly references: SchemaRepresentation.References) {}

  /** Reserves a unique type name based on `seed`. */
  name(seed: string) {
    const base = pascal(seed)
    let name = base
    for (let index = 2; this.names.has(name); index++) name = `${base}${index}`
    this.names.add(name)
    return name
  }

  deref(r: R): R {
    if (r._tag === "Reference") return this.deref(this.references[r.$ref])
    if (r._tag === "Suspend") return this.deref(r.thunk)
    return r
  }

  isDefault(type: string) {
    return (
      /^(Option|Vec|BTreeMap)</.test(type) ||
      ["String", "bool", "i64", "f64", "serde_json::Value", "()"].includes(type) ||
      this.defaultable.has(type)
    )
  }

  type(r: R, hint: string): string {
    switch (r._tag) {
      case "Reference":
        return this.reference(r.$ref)
      case "Suspend":
        return this.type(r.thunk, hint)
      case "String":
      case "TemplateLiteral":
      case "Enum":
        return "String"
      case "Number":
        return integer(r) ? "i64" : "f64"
      case "Boolean":
        return "bool"
      case "Literal":
        return literalType(r.literal)
      case "Null":
      case "Undefined":
      case "Void":
      case "Never":
        return "()"
      case "Objects":
        // An empty object says nothing about its role, so it keeps its own name instead of sharing one.
        if (r.propertySignatures.length === 0 && r.indexSignatures.length === 0)
          return this.objects(r, this.name(hint), hint)
        return this.shaped(r, () => this.objects(r, this.name(hint), hint))
      case "Arrays":
        return this.arrays(r, hint)
      case "Union":
        return this.shaped(r, () => this.union(r, hint, undefined))
      default:
        return "serde_json::Value"
    }
  }

  private shaped(r: R, make: () => string) {
    const key = JSON.stringify(r, (_, value) => (typeof value === "bigint" ? `${value}n` : value))
    const existing = this.shapes.get(key)
    if (existing !== undefined) return existing
    const type = make()
    this.shapes.set(key, type)
    return type
  }

  private reference(ref: string): string {
    const existing = this.referenced.get(ref)
    if (existing !== undefined) return existing
    if (this.visiting.has(ref)) throw new Error(`Recursive schema reference is not supported: ${ref}`)
    this.visiting.add(ref)
    const target = this.references[ref]
    const resolved = this.deref(target)
    const result = (() => {
      if (resolved._tag === "Objects" && resolved.propertySignatures.length > 0) {
        const name = this.name(ref)
        this.referenced.set(ref, name)
        return this.objects(resolved, name, name)
      }
      if (resolved._tag === "Union") {
        const shape = this.union(resolved, ref, ref)
        return shape
      }
      if (resolved._tag === "String" || resolved._tag === "TemplateLiteral") {
        const name = this.name(ref)
        this.defaultable.add(name)
        this.items.push(newtype(name, ref))
        return name
      }
      const type = this.type(target, ref)
      if (/^[A-Z][A-Za-z0-9]*$/.test(type) && !["String"].includes(type)) return type
      const name = this.name(ref)
      if (this.isDefault(type)) this.defaultable.add(name)
      this.items.push(`/// \`${ref}\`\npub type ${name} = ${type};`)
      return name
    })()
    this.visiting.delete(ref)
    this.referenced.set(ref, result)
    return result
  }

  private arrays(r: SchemaRepresentation.Arrays, hint: string): string {
    if (r.elements.length === 0 && r.rest.length === 1) return `Vec<${this.type(r.rest[0], `${hint}Item`)}>`
    if (r.rest.length === 0 && r.elements.every((element) => !element.isOptional)) {
      return `(${r.elements.map((element, index) => `${this.type(element.type, `${hint}${index}`)},`).join(" ")})`
    }
    return "Vec<serde_json::Value>"
  }

  /** A struct, or a map for an object with only index signatures. */
  objects(r: Objects, name: string, hint: string): string {
    const index = r.indexSignatures[0]
    const value = index === undefined ? undefined : this.type(index.type, `${hint}Value`)
    if (r.propertySignatures.length === 0 && value !== undefined) {
      this.names.delete(name)
      return `BTreeMap<String, ${value}>`
    }
    const used = new Set<string>()
    const fields = r.propertySignatures.flatMap((property) => {
      const key = String(property.name)
      const field = this.field(property.type, property.isOptional, `${hint}${pascal(key)}`)
      if (field === undefined) return []
      let ident = snake(key)
      for (let i = 2; used.has(ident); i++) ident = `${snake(key)}_${i}`
      used.add(ident)
      const plain = ident.replace(/^r#/, "")
      const attrs = [plain === key ? undefined : `rename = ${JSON.stringify(key)}`, ...field.attrs].filter(Boolean)
      const doc = docOf(property.annotations)
      return [
        `${doc}${attrs.length ? `    #[serde(${attrs.join(", ")})]\n` : ""}    pub ${ident}: ${field.type},`,
        field.type,
      ]
    })
    const lines = fields.filter((_, i) => i % 2 === 0)
    const types = fields.filter((_, i) => i % 2 === 1)
    if (value !== undefined) {
      lines.push(`    #[serde(flatten)]\n    pub extra: BTreeMap<String, ${value}>,`)
      types.push("BTreeMap")
    }
    const defaults = types.every((type) => this.isDefault(type) || type === "BTreeMap")
    if (defaults) this.defaultable.add(name)
    this.items.push(
      `#[derive(Debug, Clone, PartialEq, Serialize, Deserialize${defaults ? ", Default" : ""})]\npub struct ${name} {\n${lines.join("\n")}\n}`,
    )
    return name
  }

  /** A field type with its serde attributes, or undefined for a field that can only be absent. */
  field(r: R, optional: boolean, hint: string) {
    const members = r._tag === "Union" ? flatten(r.types) : [r]
    const present = members.filter((member) => !["Undefined", "Never", "Void"].includes(this.deref(member)._tag))
    if (present.length === 0) return undefined
    const nullable = present.some((member) => this.deref(member)._tag === "Null")
    const rest = present.filter((member) => this.deref(member)._tag !== "Null")
    const inner =
      rest.length === 0
        ? "()"
        : rest.length === 1
          ? this.type(rest[0], hint)
          : this.type({ ...(r as SchemaRepresentation.Union), types: rest }, hint)
    if (optional && nullable) {
      return {
        type: `Option<Option<${inner}>>`,
        attrs: ["default", 'deserialize_with = "crate::de::double_option"', 'skip_serializing_if = "Option::is_none"'],
      }
    }
    if (optional) return { type: `Option<${inner}>`, attrs: ["default", 'skip_serializing_if = "Option::is_none"'] }
    if (nullable) return { type: `Option<${inner}>`, attrs: ["default"] }
    return { type: inner, attrs: [] as Array<string> }
  }

  /** A union. `ref` names the reference it defines, if any. */
  union(r: SchemaRepresentation.Union, hint: string, ref: string | undefined): string {
    const members = flatten(r.types).filter(
      (member) => !["Undefined", "Never", "Void"].includes(this.deref(member)._tag),
    )
    const nullable = members.some((member) => this.deref(member)._tag === "Null")
    const rest = members.filter((member) => this.deref(member)._tag !== "Null")
    const wrap = (type: string) => (nullable ? `Option<${type}>` : type)
    if (rest.length === 0) return "()"
    if (rest.length === 1) return wrap(this.type(rest[0], hint))
    const resolved = rest.map((member) => this.deref(member))
    if (resolved.every((member) => member._tag === "Literal")) {
      const values = resolved.map((member) => (member as SchemaRepresentation.Literal).literal)
      if (values.every((value) => typeof value === "string")) {
        return wrap(this.literals(values as Array<string>, ref ?? hint, ref))
      }
      if (values.every((value) => typeof value === "boolean")) return wrap("bool")
      if (values.every((value) => typeof value === "number"))
        return wrap(values.every(Number.isInteger) ? "i64" : "f64")
      return wrap("serde_json::Value")
    }
    if (resolved.every((member) => ["Literal", "String", "TemplateLiteral"].includes(member._tag)))
      return wrap("String")
    if (resolved.every((member) => member._tag === "Objects")) {
      const tagged = this.discriminator(resolved as Array<Objects>)
      if (tagged !== undefined) return wrap(this.tagged(rest, tagged, ref ?? hint, ref))
    }
    return wrap(this.untagged(rest, ref ?? hint, ref))
  }

  private literals(values: Array<string>, seed: string, ref: string | undefined) {
    const name = this.name(seed)
    const variants = uniqueVariants(values.map((value) => pascal(value)))
    const doc = ref === undefined ? "" : `/// \`${ref}\`\n`
    this.items.push(
      `${doc}#[derive(Debug, Clone, PartialEq, Eq, Hash)]\npub enum ${name} {\n${variants.map((variant) => `    ${variant},`).join("\n")}\n    Unknown(String),\n}\n\nimpl ${name} {\n    pub fn as_str(&self) -> &str {\n        match self {\n${variants.map((variant, i) => `            Self::${variant} => ${JSON.stringify(values[i])},`).join("\n")}\n            Self::Unknown(value) => value,\n        }\n    }\n}\n\nimpl From<&str> for ${name} {\n    fn from(value: &str) -> Self {\n        match value {\n${variants.map((variant, i) => `            ${JSON.stringify(values[i])} => Self::${variant},`).join("\n")}\n            _ => Self::Unknown(value.to_owned()),\n        }\n    }\n}\n\nimpl Serialize for ${name} {\n    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {\n        serializer.serialize_str(self.as_str())\n    }\n}\n\nimpl<'de> Deserialize<'de> for ${name} {\n    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {\n        let value = String::deserialize(deserializer)?;\n        Ok(Self::from(value.as_str()))\n    }\n}`,
    )
    return name
  }

  /** The discriminator of an object union: a required field whose literal values tell every member apart. */
  private discriminator(members: Array<Objects>) {
    const tags = (member: Objects, key: string) => {
      const property = member.propertySignatures.find((p) => p.name === key)
      if (property === undefined || property.isOptional) return undefined
      return this.tagValues(property.type)
    }
    const keys = members[0].propertySignatures.map((p) => String(p.name))
    const ordered = [
      ...keys.filter((key) => key === "type" || key === "_tag"),
      ...keys.filter((key) => key !== "type" && key !== "_tag"),
    ]
    for (const key of ordered) {
      const values = members.map((member) => tags(member, key))
      if (values.some((value) => value === undefined)) continue
      const exact = values.flatMap((value) => value!.exact.map((item) => JSON.stringify(item)))
      if (new Set(exact).size !== exact.length) continue
      const kinds = new Set(values.flatMap((value) => value!.exact.map((item) => typeof item)))
      if (kinds.size > 1 || (kinds.size === 1 && !kinds.has("string") && !kinds.has("boolean"))) continue
      if (kinds.has("boolean") && values.some((value) => value!.prefixes.length > 0)) continue
      return { key, values: values as Array<{ exact: Array<string | boolean>; prefixes: Array<string> }> }
    }
    return undefined
  }

  private tagValues(r: R): { exact: Array<string | boolean>; prefixes: Array<string> } | undefined {
    const resolved = this.deref(r)
    if (resolved._tag === "Literal") {
      if (typeof resolved.literal !== "string" && typeof resolved.literal !== "boolean") return undefined
      return { exact: [resolved.literal], prefixes: [] }
    }
    if (resolved._tag === "TemplateLiteral") {
      const [head, ...tail] = resolved.parts
      if (head?._tag !== "Literal" || typeof head.literal !== "string") return undefined
      if (tail.length !== 1 || this.deref(tail[0])._tag !== "String") return undefined
      return { exact: [], prefixes: [head.literal] }
    }
    if (resolved._tag === "Union") {
      const parts = flatten(resolved.types).map((member) => this.tagValues(member))
      if (parts.some((part) => part === undefined)) return undefined
      return { exact: parts.flatMap((part) => part!.exact), prefixes: parts.flatMap((part) => part!.prefixes) }
    }
    return undefined
  }

  private tagged(
    members: Array<R>,
    tag: { key: string; values: Array<{ exact: Array<string | boolean>; prefixes: Array<string> }> },
    seed: string,
    ref: string | undefined,
  ) {
    const name = this.name(seed)
    const variants = uniqueVariants(
      tag.values.map((value, index) => {
        if (value.exact.length === 1) return pascal(String(value.exact[0]))
        if (value.prefixes.length > 0 && value.exact.length === 0) return pascal(value.prefixes[0])
        const member = members[index]
        return member._tag === "Reference" ? pascal(member.$ref.split(".").at(-1)!) : `Variant${index + 1}`
      }),
    )
    const types = members.map((member, index) => {
      const resolved = this.deref(member)
      if (member._tag === "Reference") return this.type(member, `${name}${variants[index]}`)
      return this.objects(resolved as Objects, this.name(`${name}${variants[index]}`), `${name}${variants[index]}`)
    })
    const kind = typeof tag.values.find((value) => value.exact.length > 0)?.exact[0]
    const access = kind === "boolean" ? "as_bool" : "as_str"
    const arms = tag.values.flatMap((value, index) => [
      ...(value.exact.length === 0
        ? []
        : [
            `            ${value.exact.map((item) => `Some(${JSON.stringify(item)})`).join(" | ")} => crate::de::variant(value).map(Self::${variants[index]}),`,
          ]),
      ...value.prefixes.map(
        (prefix) =>
          `            Some(tag) if tag.starts_with(${JSON.stringify(prefix)}) => crate::de::variant(value).map(Self::${variants[index]}),`,
      ),
    ])
    const ordered = [
      ...arms.filter((arm) => !arm.includes("starts_with")),
      ...arms.filter((arm) => arm.includes("starts_with")),
    ]
    const tagMethod =
      kind === "boolean"
        ? ""
        : `\n\nimpl ${name} {\n    /// The \`${tag.key}\` tag, also of an unknown member.\n    pub fn tag(&self) -> &str {\n        match self {\n${variants.map((variant) => `            Self::${variant}(value) => value.${snake(tag.key)}.as_str(),`).join("\n")}\n            Self::Unknown(value) => value.get(${JSON.stringify(tag.key)}).and_then(serde_json::Value::as_str).unwrap_or_default(),\n        }\n    }\n}`
    const doc = ref === undefined ? "" : `/// \`${ref}\`, tagged by \`${tag.key}\`.\n`
    this.items.push(
      `${doc}#[derive(Debug, Clone, PartialEq, Serialize)]\n#[serde(untagged)]\npub enum ${name} {\n${variants.map((variant, index) => `    ${variant}(${types[index]}),`).join("\n")}\n    /// A member this client does not know, kept as it arrived.\n    Unknown(serde_json::Value),\n}\n\nimpl<'de> Deserialize<'de> for ${name} {\n    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {\n        let value = serde_json::Value::deserialize(deserializer)?;\n        match value.get(${JSON.stringify(tag.key)}).and_then(serde_json::Value::${access}) {\n${ordered.join("\n")}\n            _ => Ok(Self::Unknown(value)),\n        }\n    }\n}${tagMethod}`,
    )
    return name
  }

  private untagged(members: Array<R>, seed: string, ref: string | undefined) {
    const name = this.name(seed)
    const seen = new Map<string, string>()
    for (const member of members) {
      const resolved = this.deref(member)
      const variant =
        member._tag === "Reference" && resolved._tag !== "String"
          ? pascal(member.$ref.split(".").at(-1)!)
          : resolved._tag === "Literal"
            ? typeof resolved.literal === "string"
              ? "String"
              : typeof resolved.literal === "boolean"
                ? "Bool"
                : "Number"
            : ((
                {
                  String: "String",
                  TemplateLiteral: "String",
                  Boolean: "Bool",
                  Number: "Number",
                  Arrays: "Array",
                  Objects: "Object",
                } as Record<string, string>
              )[resolved._tag] ?? "Value")
      const type =
        resolved._tag === "Literal"
          ? typeof resolved.literal === "string"
            ? "String"
            : typeof resolved.literal === "boolean"
              ? "bool"
              : "f64"
          : this.type(member, `${name}${variant}`)
      if ([...seen.values()].includes(type)) continue
      let unique = variant
      for (let index = 2; seen.has(unique); index++) unique = `${variant}${index}`
      seen.set(unique, type)
    }
    const doc = ref === undefined ? "" : `/// \`${ref}\`\n`
    this.items.push(
      `${doc}#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]\n#[serde(untagged)]\npub enum ${name} {\n${[...seen].map(([variant, type]) => `    ${variant}(${type}),`).join("\n")}\n    /// A shape this client does not know, kept as it arrived.\n    Unknown(serde_json::Value),\n}`,
    )
    return name
  }
}

function flatten(types: ReadonlyArray<R>): Array<R> {
  return types.flatMap((type) => (type._tag === "Union" ? flatten(type.types) : [type]))
}

function integer(r: SchemaRepresentation.Number) {
  const visit = (checks: ReadonlyArray<SchemaRepresentation.Check>): boolean =>
    checks.some((check) =>
      check._tag === "Filter" ? check.representation?.id === "effect/schema/isInt" : visit(check.checks),
    )
  return visit(r.checks)
}

function literalType(literal: unknown) {
  if (typeof literal === "string") return "String"
  if (typeof literal === "boolean") return "bool"
  if (typeof literal === "number") return Number.isInteger(literal) ? "i64" : "f64"
  return "serde_json::Value"
}

function newtype(name: string, ref: string) {
  return `/// \`${ref}\`\n#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Default, Serialize, Deserialize)]\n#[serde(transparent)]\npub struct ${name}(pub String);\n\nimpl ${name} {\n    pub fn as_str(&self) -> &str {\n        &self.0\n    }\n}\n\nimpl std::fmt::Display for ${name} {\n    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {\n        f.write_str(&self.0)\n    }\n}\n\nimpl From<String> for ${name} {\n    fn from(value: String) -> Self {\n        Self(value)\n    }\n}\n\nimpl From<&str> for ${name} {\n    fn from(value: &str) -> Self {\n        Self(value.to_owned())\n    }\n}`
}

function uniqueVariants(names: Array<string>) {
  const seen = new Set<string>(["Unknown"])
  return names.map((name) => {
    let unique = name
    for (let index = 2; seen.has(unique); index++) unique = `${name}${index}`
    seen.add(unique)
    return unique
  })
}

function docOf(annotations: { readonly [key: string]: unknown } | undefined) {
  const description = annotations?.description
  if (typeof description !== "string" || description === "") return ""
  return description
    .split("\n")
    .map((line) => `    /// ${line}`.trimEnd() + "\n")
    .join("")
}
