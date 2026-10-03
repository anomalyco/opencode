import { LLMRequest, Message, ToolDefinition, type LLMEvent, type ToolEntry } from "./schema/index.js"

/**
 * How a protocol receives tool namespaces. Callers always use the declared
 * path, e.g. `{ namespace: "crm.orders", name: "list" }`: flat protocols see
 * `crm_orders_list`, native ones see `{ namespace: "crm", name: "orders_list" }`.
 */
export type NamespaceStyle = "flat" | "native"

interface Name {
  // Declared as a tree but returned as a dotted path string, because tool parts and events carry
  // `namespace?: string`. A namespace name containing "." is therefore indistinguishable from nesting.
  readonly namespace?: string
  readonly name: string
}

/**
 * Lower declared tool names to wire names; `raise` maps tool events back.
 * Tools that share a wire name resolve last-one-wins in both directions.
 */
export const lower = (request: LLMRequest, style: NamespaceStyle) => {
  const names = new Map(
    walk(request.tools).map((leaf) => {
      const name = { namespace: leaf.path.join(".") || undefined, name: leaf.tool.name }
      return [id(wire(name, style)), name] as const
    }),
  )
  return {
    request: LLMRequest.update(request, {
      // Native namespaces are one level deep, so deeper levels join into the leaf name.
      tools:
        style === "flat"
          ? flatten(request.tools)
          : request.tools.map((tool) => (tool.type === "tool" ? tool : { ...tool, tools: flatten(tool.tools) })),
      messages: request.messages.map((msg) => {
        const content = msg.content.map((part) =>
          (part.type === "tool-call" || part.type === "tool-result") && part.namespace
            ? { ...part, ...wire(part, style) }
            : part,
        )
        return content.some((part, i) => part !== msg.content[i]) ? new Message({ ...msg, content }) : msg
      }),
    }),
    raise: (event: LLMEvent): LLMEvent => {
      const name = "name" in event ? names.get(id(event)) : undefined
      return name ? { ...event, ...name } : event
    },
  }
}

const walk = (
  tools: ReadonlyArray<ToolEntry>,
  path: ReadonlyArray<string> = [],
): Array<{ path: ReadonlyArray<string>; tool: ToolDefinition }> =>
  tools.flatMap((tool) => (tool.type === "tool" ? [{ path, tool }] : walk(tool.tools, [...path, tool.name])))

const flatten = (tools: ReadonlyArray<ToolEntry>) => [
  ...new Map(
    walk(tools).map((leaf) => {
      const name = [...leaf.path, leaf.tool.name].join("_")
      return [name, leaf.path.length ? new ToolDefinition({ ...leaf.tool, name }) : leaf.tool] as const
    }),
  ).values(),
]

const wire = (tool: Name, style: NamespaceStyle): Name => {
  const path = tool.namespace?.split(".") ?? []
  if (style === "native" && path.length) return { namespace: path[0], name: [...path.slice(1), tool.name].join("_") }
  return { namespace: undefined, name: [...path, tool.name].join("_") }
}

const id = (tool: Name) => (tool.namespace ? `${tool.namespace}.${tool.name}` : tool.name)

export * as ToolNames from "./tool-names.js"
