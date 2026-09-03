import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionV2 } from "@opencode-ai/core/session"
import { BuiltInTools } from "@opencode-ai/core/tool/builtins"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { VisualizationTool } from "@opencode-ai/core/tool/visualization"
import { ToolOutputStore } from "@opencode-ai/core/tool-output-store"
import { testEffect } from "./lib/effect"
import { executeTool, settleTool, toolDefinitions, toolIdentity } from "./lib/tool"

const sessionID = SessionV2.ID.make("ses_visualization_tool_test")
const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([ToolRegistry.node, ToolRegistry.toolsNode, VisualizationTool.node]), [
    [ToolOutputStore.node, ToolOutputStore.nodeWithoutConfig],
  ]),
)

const call = (input: { readonly title: string; readonly html: string }, id = "call-visualization") => ({
  sessionID,
  ...toolIdentity,
  call: { type: "tool-call" as const, id, name: VisualizationTool.name, input },
})

describe("VisualizationTool registration", () => {
  it.effect("registers and returns trimmed structured output with a fixed model-visible result", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const html = '<section data-kind="chart">hello</section>'

      const definitions = yield* toolDefinitions(registry)
      expect(definitions.map((tool) => tool.name)).toEqual([VisualizationTool.name])
      expect(definitions[0]?.description).toContain("transparent conversation background")
      expect(definitions[0]?.description).toContain("100vh")
      expect(definitions[0]?.description).toContain("negative page margins")
      expect(yield* settleTool(registry, call({ title: "  Quarterly chart  ", html }))).toEqual({
        result: { type: "text", value: VisualizationTool.MODEL_OUTPUT },
        output: {
          structured: { version: 1, title: "Quarterly chart", html },
          content: [{ type: "text", text: VisualizationTool.MODEL_OUTPUT }],
        },
      })
    }),
  )

  it.effect("is hidden from the catalog when its whole default action is denied", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      expect(
        yield* toolDefinitions(registry, [{ action: VisualizationTool.name, resource: "*", effect: "deny" }]),
      ).toEqual([])
    }),
  )

  test("is included in the shipped built-in dependency catalog", () => {
    expect(BuiltInTools.node.dependencies).toContain(VisualizationTool.node)
  })
})

describe("VisualizationTool validation", () => {
  it.effect("counts trimmed titles by Unicode code point", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const ascii = "a".repeat(VisualizationTool.MAX_TITLE_LENGTH)
      const emoji = "😀".repeat(VisualizationTool.MAX_TITLE_LENGTH)

      expect(yield* executeTool(registry, call({ title: ` ${ascii} `, html: "<div />" }, "call-ascii"))).toEqual({
        type: "text",
        value: VisualizationTool.MODEL_OUTPUT,
      })
      expect(yield* executeTool(registry, call({ title: ` ${emoji} `, html: "<div />" }, "call-emoji"))).toEqual({
        type: "text",
        value: VisualizationTool.MODEL_OUTPUT,
      })
      expect(
        yield* executeTool(
          registry,
          call({ title: "😀".repeat(VisualizationTool.MAX_TITLE_LENGTH + 1), html: "<div />" }, "call-too-long"),
        ),
      ).toEqual({
        type: "error",
        value: `Visualization title must contain 1 to ${VisualizationTool.MAX_TITLE_LENGTH} Unicode characters`,
      })
    }),
  )

  it.effect("enforces the HTML limit in UTF-8 bytes", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const available = VisualizationTool.MAX_HTML_BYTES - Buffer.byteLength("<p></p>", "utf-8")
      const content = "界".repeat(Math.floor(available / 3)) + "a".repeat(available % 3)
      const boundary = `<p>${content}</p>`
      const oversized = `<p>${content}😀</p>`

      expect(Buffer.byteLength(boundary, "utf-8")).toBe(VisualizationTool.MAX_HTML_BYTES)
      expect(yield* executeTool(registry, call({ title: "Boundary", html: boundary }, "call-boundary"))).toEqual({
        type: "text",
        value: VisualizationTool.MODEL_OUTPUT,
      })
      expect(yield* executeTool(registry, call({ title: "Oversized", html: oversized }, "call-oversized"))).toEqual({
        type: "error",
        value: `Visualization HTML must not exceed ${VisualizationTool.MAX_HTML_BYTES / 1024} KiB in UTF-8`,
      })
    }),
  )

  it.effect("rejects empty titles and HTML", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service

      expect(yield* executeTool(registry, call({ title: "   ", html: "<div />" }, "call-empty-title"))).toEqual({
        type: "error",
        value: `Visualization title must contain 1 to ${VisualizationTool.MAX_TITLE_LENGTH} Unicode characters`,
      })
      expect(yield* executeTool(registry, call({ title: "Empty", html: "" }, "call-empty-html"))).toEqual({
        type: "error",
        value: "Visualization HTML must not be empty",
      })
      expect(yield* executeTool(registry, call({ title: "Blank", html: " \n\t " }, "call-blank-html"))).toEqual({
        type: "error",
        value: "Visualization HTML must not be empty",
      })
    }),
  )

  it.effect("rejects document tokens nested inside fragments, including unclosed nested doctypes", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const adversarial = [
        "<div><HtMl><p>secret-nested-html</p></hTmL></div>",
        "<section><HEAD><title>secret-nested-head</title></head></section>",
        "<main><BoDy><p>secret-nested-body</p></bOdY></main>",
        "<div><span><!DoCtYpE html>secret-unclosed-doctype",
      ]

      for (const [index, html] of adversarial.entries()) {
        const result = yield* executeTool(registry, call({ title: "Nested document", html }, `call-nested-${index}`))
        expect(result).toEqual({ type: "error", value: "Visualization HTML must be a fragment" })
        expect(result.value).not.toContain("secret-")
        expect(result.value).not.toContain(html)
      }
    }),
  )

  it.effect("rejects document roots regardless of case, comments, or surrounding whitespace", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const documents = [
        " \n<!-- before --><!DoCtYpE html><main>secret-doctype</main>",
        "\t<!-- before --><HtMl><div>secret-html</div></hTmL>",
        " <!-- before --><HEAD><title>secret-head</title></head>",
        "\n<!-- before --><BoDy><p>secret-body</p></bOdY>",
      ]

      for (const [index, html] of documents.entries()) {
        const result = yield* executeTool(registry, call({ title: "Document", html }, `call-document-${index}`))
        expect(result).toEqual({ type: "error", value: "Visualization HTML must be a fragment" })
        expect(result.value).not.toContain("secret-")
        expect(result.value).not.toContain(html)
      }
    }),
  )

  it.effect("allows document-like text inside a script string", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const html = '<script>const template = "<body><main>chart</main></body>"</script><div id="chart"></div>'

      expect(yield* settleTool(registry, call({ title: "Script fragment", html }))).toEqual({
        result: { type: "text", value: VisualizationTool.MODEL_OUTPUT },
        output: {
          structured: { version: 1, title: "Script fragment", html },
          content: [{ type: "text", text: VisualizationTool.MODEL_OUTPUT }],
        },
      })
    }),
  )
})
