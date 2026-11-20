import { firstMeaningfulMermaidLine, meaningfulNumberedMermaidLines, stripMermaidQuotes } from "../core/mermaid.js"
import { MermaidSyntaxError } from "../diagnostics.js"
import type { FlowchartDirection } from "../flowchart/types.js"
import type {
  ClassDiagram,
  ClassMember,
  ClassNamespace,
  ClassNode,
  ClassRelation,
  ClassRelationMarker,
} from "./types.js"

const HEADER_RE = /^classDiagram(?:-v2)?$/i
const DIRECTION_RE = /^direction\s+(TB|TD|BT|LR|RL)$/i
const NAME = "[A-Za-z_][\\w.-]*(?:~[^~]+~)?"
const CLASS_RE = new RegExp(`^class\\s+(${NAME})(?:\\s*\\[\\s*"([^"]*)"\\s*\\])?(?::::\\S+)?\\s*(\\{)?\\s*(\\})?$`)
const NAMESPACE_RE = new RegExp(`^namespace\\s+(${NAME})\\s*\\{$`)
const MEMBER_RE = new RegExp(`^(${NAME})\\s*:\\s*(.+)$`)
const ANNOTATION_RE = /^<<\s*(.+?)\s*>>(?:\s+(\S+))?$/
const RELATION_RE = new RegExp(
  `^(${NAME})\\s*(?:"([^"]*)"\\s*)?((?:<\\||\\*|<|(?<=[\\s"])o)?)(--|\\.\\.)((?:\\|>|\\*|>|o(?=[\\s"]))?)\\s*(?:"([^"]*)"\\s*)?(${NAME})\\s*(?::\\s*(.*))?$`,
)
// Case-sensitive and checked after relations and members, so classes named `Link` or `style` still parse.
const IGNORED_RE = /^(?:classDef|cssClass|style|click|link|callback)\s/

export function isMermaidClassDiagram(content: string): boolean {
  return HEADER_RE.test(firstMeaningfulMermaidLine(content) ?? "")
}

export function parseMermaidClassDiagram(content: string): ClassDiagram {
  const classes = new Map<string, ClassNode>()
  const relations: ClassRelation[] = []
  const namespaces: ClassNamespace[] = []
  let direction: FlowchartDirection = "TB"
  let openClass: { node: ClassNode; lineNumber: number; line: string } | undefined
  let openNamespace: { namespace: ClassNamespace; lineNumber: number; line: string } | undefined

  // Generic parameters are display only: `Box~T~` and `Box` are the same class.
  // Only `class` statements place a class in the open namespace; relations just refer to classes.
  const ensure = (name: string, declared = false) => {
    const generic = name.match(/^(.*?)~([^~]+)~$/)
    const id = generic ? generic[1]! : name
    const node = classes.get(id) ?? { id, label: id, annotations: [], attributes: [], methods: [] }
    classes.set(id, node)
    if (generic && node.label === id) node.label = `${id}<${generic[2]}>`
    if (declared && openNamespace && !openNamespace.namespace.classIds.includes(id))
      openNamespace.namespace.classIds.push(id)
    return node
  }

  for (const source of meaningfulNumberedMermaidLines(content)) {
    const line = source.text
    if (HEADER_RE.test(line)) continue

    if (openClass) {
      if (line === "}") {
        openClass = undefined
        continue
      }
      const annotation = line.match(ANNOTATION_RE)
      if (annotation && !annotation[2]) {
        openClass.node.annotations.push(annotation[1]!)
        continue
      }
      addMember(openClass.node, line)
      continue
    }

    const directionMatch = line.match(DIRECTION_RE)
    if (directionMatch) {
      direction = directionMatch[1]!.toUpperCase() as FlowchartDirection
      continue
    }
    if (line === "}") {
      if (!openNamespace) throw new MermaidSyntaxError("class", source.lineNumber, line, 'Unexpected "}"')
      openNamespace = undefined
      continue
    }

    const namespaceMatch = line.match(NAMESPACE_RE)
    if (namespaceMatch) {
      if (openNamespace) throw new MermaidSyntaxError("class", source.lineNumber, line, "Nested namespaces")
      const namespace = { id: genericText(namespaceMatch[1]!), classIds: [] }
      namespaces.push(namespace)
      openNamespace = { namespace, lineNumber: source.lineNumber, line }
      continue
    }

    const classMatch = line.match(CLASS_RE)
    if (classMatch) {
      const node = ensure(classMatch[1]!, true)
      if (classMatch[2] !== undefined) node.label = stripMermaidQuotes(classMatch[2])
      if (classMatch[3] && !classMatch[4]) openClass = { node, lineNumber: source.lineNumber, line }
      continue
    }

    const annotation = line.match(ANNOTATION_RE)
    if (annotation?.[2]) {
      ensure(annotation[2]).annotations.push(annotation[1]!)
      continue
    }

    const relation = line.match(RELATION_RE)
    if (relation) {
      const from = ensure(relation[1]!).id
      const to = ensure(relation[7]!).id
      const fromMarker = marker(relation[3]!)
      const toMarker = marker(relation[5]!)
      relations.push({
        from,
        to,
        label: stripMermaidQuotes(relation[8] ?? ""),
        dashed: relation[4] === "..",
        ...(fromMarker ? { fromMarker } : {}),
        ...(toMarker ? { toMarker } : {}),
        ...(relation[2] ? { fromCardinality: relation[2] } : {}),
        ...(relation[6] ? { toCardinality: relation[6] } : {}),
      })
      continue
    }

    const member = line.match(MEMBER_RE)
    if (member) {
      addMember(ensure(member[1]!), member[2]!)
      continue
    }
    if (IGNORED_RE.test(line)) continue

    throw new MermaidSyntaxError("class", source.lineNumber, line)
  }

  const unclosed = openClass ?? openNamespace
  if (unclosed)
    throw new MermaidSyntaxError("class", unclosed.lineNumber, unclosed.line, 'Unclosed block; expected "}"')

  return { direction, classes: [...classes.values()], relations, namespaces }
}

function genericText(value: string): string {
  return value.replace(/~([^~]+)~/g, "<$1>")
}

function marker(value: string): ClassRelationMarker | undefined {
  if (value === "<|" || value === "|>") return "inheritance"
  if (value === "*") return "composition"
  if (value === "o") return "aggregation"
  if (value === "<" || value === ">") return "arrow"
  return undefined
}

function addMember(node: ClassNode, raw: string): void {
  // A leading `~` is package visibility, not the start of a generic.
  const visibility = /^[+\-#~]/.test(raw.trim()) ? raw.trim()[0]! : ""
  const text = `${visibility}${genericText(raw.trim().slice(visibility.length))}`
  const isMethod = /\(.*\)/.test(text)
  const target = isMethod ? node.methods : node.attributes
  const classifier = text.match(isMethod ? /\)\s*([*$])|([*$])$/ : /([*$])$/)
  if (!classifier) {
    target.push({ text })
    return
  }
  const symbol = classifier[1] ?? classifier[2]!
  const at = classifier.index! + classifier[0].lastIndexOf(symbol)
  const member: ClassMember = {
    text: `${text.slice(0, at)}${text.slice(at + 1)}`.trim(),
    classifier: symbol === "*" ? "abstract" : "static",
  }
  target.push(member)
}
