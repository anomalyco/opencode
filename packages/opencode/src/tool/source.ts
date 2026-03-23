import { Tool } from "./tool"

export namespace ToolSource {
  export interface Interface {
    readonly id: string
    readonly description?: string
    tools(): Promise<Tool.Info[]>
    onChange?: (callback: (changed: string[]) => void) => void
  }

  // Compose multiple sources. Later sources win on duplicate tool ids.
  export function compose(...sources: Interface[]): Interface {
    return {
      id: "composed",
      async tools() {
        const all: Tool.Info[] = []
        const seen = new Map<string, number>()
        for (const source of sources) {
          for (const tool of await source.tools()) {
            const idx = seen.get(tool.id)
            if (idx !== undefined) {
              all[idx] = tool // later source wins
            } else {
              seen.set(tool.id, all.length)
              all.push(tool)
            }
          }
        }
        return all
      },
      onChange(callback) {
        for (const s of sources) s.onChange?.(callback)
      },
    }
  }

  // Wrap a static array into a ToolSource
  export function fromBuiltin(tools: Tool.Info[]): Interface {
    return {
      id: "builtin",
      description: "Built-in tools",
      async tools() {
        return tools
      },
    }
  }

  // Wrap an async function into a ToolSource
  export function fromIterable(id: string, fn: () => Promise<Tool.Info[]>): Interface {
    return {
      id,
      async tools() {
        return fn()
      },
    }
  }
}
