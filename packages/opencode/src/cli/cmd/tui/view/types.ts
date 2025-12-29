// packages/opencode/src/cli/cmd/tui/view/types.ts
import z from "zod"

export namespace View {
  // Base view info shared by all view types
  export const Base = z.object({
    id: z.string(),
    title: z.string(),
  })

  // Tree view for hierarchical data (session explorer, file browser)
  export namespace Tree {
    export const Node: z.ZodType<NodeInfo> = z.lazy(() =>
      z.object({
        id: z.string(),
        label: z.string(),
        icon: z.string().optional(),
        children: z.array(Node),
        expanded: z.boolean().optional().default(false),
        metadata: z.record(z.string(), z.any()).optional(),
      }),
    )

    export type NodeInfo = {
      id: string
      label: string
      icon?: string
      children: NodeInfo[]
      expanded?: boolean
      metadata?: Record<string, any>
    }

    export const Info = Base.extend({
      type: z.literal("tree"),
      nodes: z.array(Node),
      selectedID: z.string().optional(),
    })
    export type Info = z.output<typeof Info>

    export function create(input: { id: string; title: string; nodes: NodeInfo[]; selectedID?: string }): Info {
      return {
        type: "tree",
        id: input.id,
        title: input.title,
        nodes: input.nodes,
        selectedID: input.selectedID,
      }
    }
  }

  // List view for flat searchable items (command palette, session list)
  export namespace List {
    export const Item = z.object({
      id: z.string(),
      label: z.string(),
      description: z.string().optional(),
      icon: z.string().optional(),
      metadata: z.record(z.string(), z.any()).optional(),
    })
    export type Item = z.output<typeof Item>

    export const Info = Base.extend({
      type: z.literal("list"),
      items: z.array(Item),
      searchable: z.boolean().optional().default(true),
      selectedID: z.string().optional(),
      searchQuery: z.string().optional(),
    })
    export type Info = z.output<typeof Info>

    export function create(input: {
      id: string
      title: string
      items: Item[]
      searchable?: boolean
      selectedID?: string
    }): Info {
      return {
        type: "list",
        id: input.id,
        title: input.title,
        items: input.items,
        searchable: input.searchable ?? true,
        selectedID: input.selectedID,
      }
    }
  }

  // Text view for read-only styled content (logs, previews, help)
  export namespace Text {
    export const Info = Base.extend({
      type: z.literal("text"),
      content: z.string(),
      filetype: z.string().optional(),
      scrollOffset: z.number().optional().default(0),
    })
    export type Info = z.output<typeof Info>

    export function create(input: { id: string; title: string; content: string; filetype?: string }): Info {
      return {
        type: "text",
        id: input.id,
        title: input.title,
        content: input.content,
        filetype: input.filetype,
        scrollOffset: 0,
      }
    }
  }

  // Form view for settings and input
  export namespace Form {
    export const Field = z.discriminatedUnion("type", [
      z.object({
        id: z.string(),
        type: z.literal("text"),
        label: z.string(),
        value: z.string().optional(),
        placeholder: z.string().optional(),
      }),
      z.object({
        id: z.string(),
        type: z.literal("toggle"),
        label: z.string(),
        value: z.boolean().optional(),
      }),
      z.object({
        id: z.string(),
        type: z.literal("select"),
        label: z.string(),
        options: z.array(z.string()),
        value: z.string().optional(),
      }),
      z.object({
        id: z.string(),
        type: z.literal("number"),
        label: z.string(),
        value: z.number().optional(),
        min: z.number().optional(),
        max: z.number().optional(),
      }),
    ])
    export type Field = z.output<typeof Field>

    export const Info = Base.extend({
      type: z.literal("form"),
      fields: z.array(Field),
      focusedFieldID: z.string().optional(),
    })
    export type Info = z.output<typeof Info>

    export function create(input: { id: string; title: string; fields: Field[] }): Info {
      return {
        type: "form",
        id: input.id,
        title: input.title,
        fields: input.fields,
      }
    }
  }

  // Union of all view types
  export type Info = Tree.Info | List.Info | Text.Info | Form.Info

  // Built-in view identifiers (not replaceable by plugins)
  export const BuiltIn = z.enum(["session", "home"])
  export type BuiltIn = z.infer<typeof BuiltIn>
}
