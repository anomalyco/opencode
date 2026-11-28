// Tool paths are canonical everywhere outside one compiled request: `lookup` in the `crm` namespace is `crm.lookup`
// in `toolChoice` and `Message.tools` removals, and `{ namespace: "crm", name: "lookup" }` on calls and results.
// `lower` maps them to the names the request's protocol sends, once per request, and `decode` maps the provider's
// names back, so steps, compaction and replay on another provider all agree.
import { Result } from "effect"
import {
  AIError,
  AssistantMessage,
  InvalidRequestError,
  SystemMessage,
  ToolCallPart,
  ToolChoice,
  ToolDefinition,
  ToolMessage,
  type ContentPart,
  type LLMEvent,
  type LLMRequest,
  type ToolEntry,
  type ToolResultPart,
} from "./schema/index.js"
import { foldTools, toolLeaves, toolsUpdate, withdrawnTools } from "./tool-updates.js"

interface ToolIdentity {
  readonly name: string
  readonly namespace?: string
}

/** The provider names of one lowered request, and the canonical tools they stand for. */
export interface ToolNames {
  /** The canonical identity of a name the provider sent; a name no tool declares comes back as received. */
  readonly decode: <Value extends ToolIdentity>(value: Value) => Value
  /** `decode` applied to the tool events of a provider stream. */
  readonly decodeEvent: (event: LLMEvent) => LLMEvent
}

/**
 * Lower a request's tool paths to the names its protocol sends. A protocol with native namespaces
 * (`route.namespaces`) keeps the first level and joins deeper ones with `_`; every other protocol gets flat names
 * joined with `_`. Two tools that would go out under the same name fail. Past calls to declared tools go out under
 * their tool's name; calls to other names, including flattened names older histories recorded, are mapped through
 * the table or made provider-safe.
 */
export const lower = (
  request: LLMRequest,
): Result.Result<{ readonly request: LLMRequest; readonly names: ToolNames }, AIError> => {
  const leaves = toolLeaves([
    ...request.tools,
    ...request.messages.flatMap((message) => toolsUpdate(message)?.add ?? []),
  ])
  const chosen = choicePath(request.toolChoice, leaves)
  if (Result.isFailure(chosen)) return Result.fail(chosen.failure)
  // OpenAI Responses can't force a tool inside a namespace, so a request that does sends flat names.
  const native = request.model.route.namespaces === true && (chosen.success?.length ?? 0) < 2
  const table = nameTable(leaves, native)
  if (Result.isFailure(table)) return Result.fail(table.failure)
  const byPath = table.success.byPath
  const byWire = table.success.byWire
  const aliases = table.success.aliases
  const wireOf = (path: string) => byPath.get(path) ?? { name: path }
  // Models sometimes call names no tool declares, such as a Code Mode path like `a.b.c`, and a tool can be withdrawn
  // after its calls. These go out as they would if declared, with the characters several providers reject in replayed
  // names replaced; the history keeps the name as called.
  const undeclared = (part: ToolIdentity) =>
    wireName([...(part.namespace?.split(".") ?? []), part.name].map(safeName), native)

  const encode = <Part extends ToolCallPart | ToolResultPart>(part: Part): Part => {
    const alias = part.namespace === undefined ? aliases.get(part.name) : undefined
    const wire =
      byPath.get(ToolCallPart.path(part)) ?? (alias === undefined ? undefined : byPath.get(alias)) ?? undeclared(part)
    return wire.name === part.name && wire.namespace === part.namespace
      ? part
      : { ...part, name: wire.name, namespace: wire.namespace }
  }

  const entries = (tools: ReadonlyArray<ToolEntry>): ReadonlyArray<ToolEntry> =>
    unique(
      tools.flatMap((tool): ReadonlyArray<ToolEntry> => {
        if (tool.type === "tool") return [tool]
        if (!native) return flat(toolLeaves([tool]))
        return [
          {
            type: "namespace",
            name: tool.name,
            description: tool.description,
            tools: unique(flat(toolLeaves(tool.tools))),
          },
        ]
      }),
    )

  // A tool change that redefines a namespace drops the tools it leaves out, which only the namespace shows, so name
  // every tool the change withdraws.
  let tools = request.tools
  const messages = request.messages.map((message) => {
    if (message.role === "system" && message.tools !== undefined) {
      const next = foldTools(tools, message.tools.add, message.tools.remove)
      const remove = withdrawnTools(tools, next).map((path) => ToolCallPart.path(wireOf(path)))
      tools = next
      return new SystemMessage({ ...message, tools: { add: entries(message.tools.add), remove } })
    }
    if (message.role === "assistant") {
      const content = message.content.map((part) =>
        part.type === "tool-call" || part.type === "tool-result" ? encode(part) : part,
      )
      return sameParts(content, message.content) ? message : new AssistantMessage({ ...message, content })
    }
    if (message.role !== "tool") return message
    const content = message.content.map(encode)
    return sameParts(content, message.content) ? message : new ToolMessage({ ...message, content })
  })

  const decode = <Value extends ToolIdentity>(value: Value): Value => {
    const path = byWire.get(ToolCallPart.path(value))
    if (path === undefined) return value
    const dot = path.lastIndexOf(".")
    const name = dot === -1 ? path : path.slice(dot + 1)
    const namespace = dot === -1 ? undefined : path.slice(0, dot)
    return name === value.name && namespace === value.namespace ? value : { ...value, name, namespace }
  }

  const choice = request.toolChoice
  return Result.succeed({
    request: {
      ...request,
      tools: entries(request.tools),
      messages,
      toolChoice:
        choice === undefined || chosen.success === undefined
          ? choice
          : new ToolChoice({ ...choice, name: ToolCallPart.path(wireOf(chosen.success.join("."))) }),
    },
    names: {
      decode,
      decodeEvent: (event) => {
        switch (event.type) {
          case "tool-input-start":
          case "tool-input-delta":
          case "tool-input-end":
          case "tool-input-error":
          case "tool-call":
          case "tool-result":
            return decode(event)
        }
        return event
      },
    },
  })
}

type Leaves = ReturnType<typeof toolLeaves>

// Each declared path's provider name, the path back from it, and the `_`-joined names older histories recorded for
// namespaced tools (`undefined` when two paths join to the same one).
const nameTable = (leaves: Leaves, native: boolean) => {
  const byPath = new Map<string, ToolIdentity>()
  const byWire = new Map<string, string>()
  const aliases = new Map<string, string | undefined>()
  for (const leaf of leaves) {
    const path = leaf.path.join(".")
    const wire = wireName(leaf.path, native)
    const key = ToolCallPart.path(wire)
    const owner = byWire.get(key)
    if (owner !== undefined && owner !== path)
      return Result.fail(invalid(`Tools "${owner}" and "${path}" would both be sent as "${key}"; rename one of them`))
    byPath.set(path, wire)
    byWire.set(key, path)
    const joined = leaf.path.join("_")
    if (leaf.path.length > 1)
      aliases.set(joined, aliases.has(joined) && aliases.get(joined) !== path ? undefined : path)
  }
  return Result.succeed({ byPath, byWire, aliases })
}

// The path of the tool a forced choice names: its path, or the name of the one tool called that.
const choicePath = (choice: LLMRequest["toolChoice"], leaves: Leaves) => {
  if (choice?.type !== "tool" || choice.name === undefined) return Result.succeed(undefined)
  const name = choice.name
  const exact = leaves.find((leaf) => leaf.path.join(".") === name)
  if (exact) return Result.succeed(exact.path)
  const named = name.includes(".") ? [] : leaves.filter((leaf) => leaf.path.at(-1) === name)
  if (named.length > 1)
    return Result.fail(
      invalid(
        `Tool choice "${name}" matches ${named.map((leaf) => `"${leaf.path.join(".")}"`).join(" and ")}; name it by its path`,
      ),
    )
  return Result.succeed(named[0]?.path)
}

const flat = (leaves: Leaves) =>
  leaves.map((leaf) => {
    const name = leaf.path.join("_")
    return name === leaf.definition.name ? leaf.definition : new ToolDefinition({ ...leaf.definition, name })
  })

// One entry per name and type, at the first one's position with the last one's definition.
const unique = (tools: ReadonlyArray<ToolEntry>) => [
  ...new Map(tools.map((tool) => [`${tool.type}:${tool.name}`, tool])).values(),
]

// The name a tool at `path` goes out under: the first level as a native namespace where the protocol has them, and
// every other level joined with `_`.
const wireName = (path: ReadonlyArray<string>, native: boolean): ToolIdentity =>
  native && path.length > 1 ? { namespace: path[0], name: path.slice(1).join("_") } : { name: path.join("_") }

const safeName = (path: string) => path.replace(/[^a-zA-Z0-9_-]/g, "_") || "_"

const sameParts = (next: ReadonlyArray<ContentPart>, previous: ReadonlyArray<ContentPart>) =>
  next.every((part, index) => part === previous[index])

const invalid = (message: string) => new AIError({ reason: new InvalidRequestError({ message }) })

export * as ToolNames from "./tool-names.js"
