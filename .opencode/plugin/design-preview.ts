import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import path from "path"

const STALE = 60_000
const VISUAL_EXT = new Set([".tsx", ".jsx", ".ts", ".js", ".vue", ".svelte", ".html", ".css", ".scss", ".less"])
const EDIT_TOOLS = new Set(["write", "edit", "multiedit", "patch"])

const PRESETS: Record<string, { width: number; height: number }> = {
  mobile: { width: 375, height: 812 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: 1440, height: 900 },
}

async function read(dir: string) {
  const file = Bun.file(path.join(dir, ".opencode", ".design-state.json"))
  if (!(await file.exists())) return null
  const data = await file.json().catch(() => null)
  if (!data || !data.timestamp) return null
  if (Date.now() - data.timestamp > STALE) return null
  return data
}

async function command(dir: string, data: Record<string, unknown>) {
  await Bun.write(
    path.join(dir, ".opencode", ".design-command.json"),
    JSON.stringify({ ...data, timestamp: Date.now() }),
  )
}

export const server: Plugin = async (ctx) => {
  const dir = ctx.directory

  return {
    tool: {
      get_selected_element: tool({
        description: `Get detailed information about the element currently selected by the user in the visual design editor. Returns tag name, classes, styles, source file location, and DOM path. Call this whenever the user refers to something they're looking at — words like 'this', 'that', 'the button', 'make it bigger' all mean the user is pointing at the selected element.`,
        args: {},
        async execute() {
          const state = await read(dir)
          if (!state?.selectedElement) return "No element is currently selected in the Design Preview. Ask the user to click on an element in the preview panel first."

          const el = state.selectedElement
          const lines: string[] = []

          if (el.sourceFile) {
            lines.push(`**Source:** ${el.sourceFile}${el.sourceLine ? `:${el.sourceLine}` : ""}`)
          }

          const tag = `<${el.tagName}${el.id ? `#${el.id}` : ""}${el.className ? `.${el.className.split(" ").join(".")}` : ""}>`
          lines.push(`**Element:** ${tag}`)
          lines.push(`**DOM Path:** ${el.domPath}`)

          if (el.boundingRect) {
            const r = el.boundingRect
            lines.push(`**Size:** ${Math.round(r.width)}×${Math.round(r.height)}px at (${Math.round(r.x)}, ${Math.round(r.y)})`)
          }

          if (el.computedStyles && Object.keys(el.computedStyles).length > 0) {
            const pairs = Object.entries(el.computedStyles)
              .map(([k, v]) => `  ${k}: ${v}`)
              .join("\n")
            lines.push(`**Computed Styles:**\n${pairs}`)
          }

          return lines.join("\n")
        },
      }),

      get_design_comments: tool({
        description: `Get all design comments the user has pinned on elements in the visual preview. Each comment includes the target element info and the user's note. Use this to understand what changes the user wants across multiple elements.`,
        args: {},
        async execute() {
          const state = await read(dir)
          if (!state?.comments?.length) return "No design comments are currently pinned in the Design Preview."

          return state.comments
            .map((c: Record<string, any>, i: number) => {
              const parts = [`${i + 1}. "${c.text}"`]
              if (c.element?.tagName) parts.push(`   Element: <${c.element.tagName}${c.element.className ? `.${c.element.className}` : ""}>`)
              if (c.element?.sourceFile) parts.push(`   Source: ${c.element.sourceFile}`)
              if (c.element?.domPath) parts.push(`   Path: ${c.element.domPath}`)
              return parts.join("\n")
            })
            .join("\n\n")
        },
      }),

      update_element_styles: tool({
        description: `Apply CSS style changes to the currently selected element in real-time for instant visual feedback. Use camelCase property names (e.g. backgroundColor, borderRadius). After calling this, also edit the source file to persist the change — this tool only changes the live preview temporarily.`,
        args: {
          styles: tool.schema.string().describe("JSON string of camelCase CSS properties, e.g. {\"backgroundColor\":\"#ff0000\",\"padding\":\"16px\"}"),
        },
        async execute(args) {
          const parsed = JSON.parse(args.styles)
          await command(dir, { type: "update-styles", styles: parsed })
          return "Styles applied to the live preview. Remember to also edit the source file to persist these changes."
        },
      }),

      select_element: tool({
        description: `Select and highlight a specific element in the visual preview by CSS selector. Use this to show the user which element you're referring to before making changes.`,
        args: {
          selector: tool.schema.string().describe("CSS selector string, e.g. '.btn-primary', '#header', 'nav > ul > li:first-child'"),
        },
        async execute(args) {
          await command(dir, { type: "select", selector: args.selector })
          return `Selected element matching "${args.selector}" in the design preview.`
        },
      }),

      set_viewport: tool({
        description: `Change the viewport size of the design preview. Use 'mobile' (375×812), 'tablet' (768×1024), or 'desktop' (full width). Call this when discussing responsive design or when the user wants to check how something looks on a different screen size.`,
        args: {
          preset: tool.schema.string().optional().describe("Viewport preset: 'mobile', 'tablet', or 'desktop'"),
          width: tool.schema.number().optional().describe("Custom viewport width in pixels"),
          height: tool.schema.number().optional().describe("Custom viewport height in pixels"),
        },
        async execute(args) {
          const p = args.preset ? PRESETS[args.preset] : undefined
          const w = p?.width ?? args.width ?? 1440
          const h = p?.height ?? args.height ?? 900
          await command(dir, { type: "set-viewport", preset: args.preset, width: w, height: h })
          return `Viewport set to ${w}×${h}${args.preset ? ` (${args.preset})` : ""}.`
        },
      }),
    },

    "experimental.chat.system.transform": async (_input, output) => {
      const state = await read(dir)
      if (!state) return

      const lines: string[] = [
        "",
        "## Visual Design Editor",
        "",
        "The user has a live Design Preview panel open showing their running web app. You have access to design tools:",
        "",
        "- **get_selected_element** — Call this whenever the user says 'this', 'that', 'the button', 'make it bigger', or refers to anything visible. Returns element details, source file, and computed styles.",
        "- **get_design_comments** — Read all comments the user pinned on the preview.",
        "- **update_element_styles** — Apply CSS changes to the selected element instantly (preview only, not persisted).",
        "- **select_element** — Highlight an element by CSS selector to show the user what you mean.",
        "- **set_viewport** — Switch between mobile/tablet/desktop viewports.",
        "",
        "### Workflow",
        "1. User selects element or describes a change",
        "2. Call `get_selected_element` to see what they're pointing at",
        "3. Read the source file indicated in the response",
        "4. Edit the source file to make the change",
        "5. Optionally call `update_element_styles` for instant visual feedback",
        "",
        "### Critical Rules",
        "- When the user uses deictic references ('this', 'that', 'the header', etc.), ALWAYS call `get_selected_element` first.",
        "- ALWAYS edit the actual source file to persist changes. The live preview is temporary.",
      ]

      if (state.selectedElement) {
        const el = state.selectedElement
        const tag = `<${el.tagName}${el.id ? `#${el.id}` : ""}${el.className ? `.${el.className.split(" ").join(".")}` : ""}>`
        const src = el.sourceFile ? ` at \`${el.sourceFile}${el.sourceLine ? `:${el.sourceLine}` : ""}\`` : ""
        lines.push("", `**Currently selected:** \`${tag}\`${src}`)
      }

      if (state.comments?.length) {
        lines.push("", `**Design comments (${state.comments.length}):**`)
        for (const c of state.comments) {
          const on = c.element?.tagName ? ` on <${c.element.tagName}>` : ""
          lines.push(`- "${c.text}"${on}`)
        }
      }

      output.system.push(lines.join("\n"))
    },

    "tool.execute.after": async (input, _output) => {
      if (!EDIT_TOOLS.has(input.tool)) return
      const args = input.args
      if (!args) return

      const file = args.filePath ?? args.file_path ?? args.path ?? args.file
      if (typeof file !== "string") return

      const ext = path.extname(file)
      if (!VISUAL_EXT.has(ext)) return

      await command(dir, { type: "file-changed", filePath: file })
    },
  }
}
