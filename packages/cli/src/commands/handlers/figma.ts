import { Effect } from "effect"
import path from "path"
import { UI } from "../ui"
import { effectCmd, fail } from "../effect-cmd"

// Serialized design JSON larger than this is too big to prompt in one shot.
const LIMIT = 120_000
const DEPTH = 12
const CHILDREN = 40
const TEXT = 2_000

// Node types whose payload is raw vector geometry; their paint summary is kept
// but their children (more geometry) carry nothing the generated code needs.
const VECTORS = new Set(["VECTOR", "LINE", "ELLIPSE", "STAR", "REGULAR_POLYGON", "BOOLEAN_OPERATION"])

export type Color = {
  r: number
  g: number
  b: number
  a?: number
}

export type Paint = {
  type?: string
  visible?: boolean
  opacity?: number
  color?: Color
}

export type Node = {
  type?: string
  name?: string
  layoutMode?: string
  itemSpacing?: number
  paddingLeft?: number
  paddingRight?: number
  paddingTop?: number
  paddingBottom?: number
  cornerRadius?: number
  characters?: string
  style?: {
    fontFamily?: string
    fontSize?: number
    fontWeight?: number
  }
  fills?: Paint[]
  children?: Node[]
}

export type Design = {
  type?: string
  name?: string
  layout?: string
  gap?: number
  padding?: { left: number; right: number; top: number; bottom: number }
  radius?: number
  fills?: string[]
  font?: { family?: string; size?: number; weight?: number }
  text?: string
  children?: Design[]
}

/** Extract the file key and node id from a Figma file or design URL. */
export function parse(url: string) {
  if (!URL.canParse(url)) return undefined
  const parsed = new URL(url)
  if (parsed.hostname !== "figma.com" && !parsed.hostname.endsWith(".figma.com")) return undefined
  const match = parsed.pathname.match(/^\/(?:file|design)\/([A-Za-z0-9]+)(?:\/|$)/)
  if (!match) return undefined
  const raw = parsed.searchParams.get("node-id")
  // Figma URLs encode node ids as 12-34 but the REST API expects 12:34.
  return { key: match[1], node: raw ? raw.replace(/-/g, ":") : undefined }
}

/** Convert a Figma normalized RGBA color (plus paint opacity) to a hex string. */
export function hex(color: Color, opacity?: number) {
  const channel = (value: number) =>
    Math.round(Math.max(0, Math.min(1, value)) * 255)
      .toString(16)
      .padStart(2, "0")
  const alpha = (color.a ?? 1) * (opacity ?? 1)
  const base = `#${channel(color.r)}${channel(color.g)}${channel(color.b)}`
  if (alpha >= 1) return base
  return base + channel(alpha)
}

/**
 * Reduce a raw Figma node tree to the design props that matter for code
 * generation: layout, spacing, color, typography, text, and structure.
 * Raw vector geometry is dropped and depth/fanout are capped.
 */
export function simplify(node: Node, depth = 0): Design | undefined {
  if (depth > DEPTH) return undefined
  const out: Design = {}
  if (node.type) out.type = node.type
  if (node.name) out.name = node.name
  if (node.layoutMode && node.layoutMode !== "NONE") out.layout = node.layoutMode.toLowerCase()
  if (node.itemSpacing) out.gap = node.itemSpacing
  const left = node.paddingLeft ?? 0
  const right = node.paddingRight ?? 0
  const top = node.paddingTop ?? 0
  const bottom = node.paddingBottom ?? 0
  if (left || right || top || bottom) out.padding = { left, right, top, bottom }
  if (node.cornerRadius) out.radius = node.cornerRadius
  const fills = (node.fills ?? []).flatMap((fill) => {
    if (fill.visible === false) return []
    if (fill.type !== "SOLID") return []
    const color = fill.color
    if (!color) return []
    return [hex(color, fill.opacity)]
  })
  if (fills.length) out.fills = fills
  const style = node.style
  if (style && (style.fontFamily || style.fontSize || style.fontWeight)) {
    out.font = { family: style.fontFamily, size: style.fontSize, weight: style.fontWeight }
  }
  if (node.characters) out.text = node.characters.slice(0, TEXT)
  if (node.type && VECTORS.has(node.type)) return out
  const children = (node.children ?? [])
    .slice(0, CHILDREN)
    .map((child) => simplify(child, depth + 1))
    .filter((child): child is Design => child !== undefined)
  if (children.length) out.children = children
  return out
}

const INSTRUCTIONS = [
  "You are given a simplified JSON export of a Figma design node. Generate component code that reproduces it.",
  "First inspect the repository with the read, grep, and glob tools to detect the framework, language, styling approach, and component conventions, then match them. Reuse existing design tokens, theme values, and primitives when they fit the design.",
  "Write the generated component files under the output directory using your file tools. Do not modify unrelated files.",
  "End your final message by listing each file you wrote with a one-line description.",
].join("\n")

export const FigmaCommand = effectCmd({
  command: "figma <url>",
  describe: "generate components from a Figma design node",
  builder: (yargs) =>
    yargs
      .positional("url", {
        type: "string",
        describe: "Figma file or design URL including a node-id",
        demandOption: true,
      })
      .option("out", {
        type: "string",
        describe: "directory to write generated components to (defaults to the current directory)",
      })
      .option("model", {
        alias: "m",
        type: "string",
        describe: "model to use in the format of provider/model",
      }),
  handler: Effect.fn("Cli.figma")(function* (args) {
    const target = parse(args.url)
    if (!target) {
      return yield* fail(
        "Could not parse the Figma URL. Expected https://www.figma.com/design/<key>/... or https://www.figma.com/file/<key>/...",
      )
    }
    const node = target.node
    if (!node) {
      return yield* fail(
        "The URL has no node-id. In Figma, select a frame or component and copy its link so the URL contains node-id.",
      )
    }
    const token = process.env["FIGMA_TOKEN"]
    if (!token) {
      return yield* fail(
        "FIGMA_TOKEN is not set. Create a personal access token in Figma settings and export it as FIGMA_TOKEN.",
      )
    }

    UI.println("Fetching the design from Figma...")
    const res = yield* Effect.promise(() =>
      fetch(`https://api.figma.com/v1/files/${target.key}/nodes?ids=${encodeURIComponent(node)}`, {
        headers: { "X-Figma-Token": token },
      }).then(
        (value) => value,
        () => undefined,
      ),
    )
    if (!res) return yield* fail("Could not reach the Figma API. Check your network connection and try again.")
    if (!res.ok) {
      return yield* fail(
        `The Figma API returned ${res.status}. Check that FIGMA_TOKEN is valid and the file is accessible.`,
      )
    }
    const body = yield* Effect.promise(() =>
      res.json().then(
        (value) => value as { nodes?: Record<string, { document?: Node }> },
        () => undefined,
      ),
    )
    const document = body?.nodes?.[node]?.document
    if (!document) return yield* fail(`Node ${node} was not found in file ${target.key}.`)

    const design = simplify(document)
    if (!design) return yield* fail("Could not extract any design data from the node.")
    const json = JSON.stringify(design, null, 2)
    if (json.length > LIMIT) {
      return yield* fail("The selected node is too large to hand to the agent in one shot. Link a smaller frame.")
    }

    const out = args.out ? path.resolve(process.cwd(), args.out) : process.cwd()

    UI.println("Generating components...")

    const { Session } = yield* Effect.promise(() => import("@/session/session"))
    const { SessionPrompt } = yield* Effect.promise(() => import("@/session/prompt"))
    const { MessageID, PartID } = yield* Effect.promise(() => import("../../session/schema"))
    const { parseModel } = yield* Effect.promise(() => import("@/provider/provider"))
    const { extractResponseText } = yield* Effect.promise(() => import("./github.shared"))
    const sessions = yield* Session.Service
    const prompt = yield* SessionPrompt.Service
    const session = yield* sessions.create({
      title: "bolt figma",
      permission: [
        { permission: "question", action: "deny", pattern: "*" },
        { permission: "plan_enter", action: "deny", pattern: "*" },
        { permission: "plan_exit", action: "deny", pattern: "*" },
        // Nobody is around to answer permission prompts, so pre-approve writes
        // to the requested output directory when it is outside the worktree.
        { permission: "external_directory", action: "allow", pattern: path.join(out, "*") },
      ],
    })

    const result = yield* prompt
      .prompt({
        sessionID: session.id,
        messageID: MessageID.ascending(),
        model: args.model ? parseModel(args.model) : undefined,
        parts: [
          {
            id: PartID.ascending(),
            type: "text",
            text: `${INSTRUCTIONS}\n\nOutput directory: ${out}\n\nDesign JSON:\n${json}`,
          },
        ],
      })
      .pipe(Effect.orDie)

    if (result.info.role === "assistant" && result.info.error) {
      const err = result.info.error
      const message = "message" in err.data ? err.data.message : ""
      return yield* fail(`${err.name}: ${message}`)
    }

    const text = extractResponseText(result.parts) ?? ""
    if (!text) return yield* fail("The model returned an empty response.")

    UI.empty()
    UI.println(UI.markdown(text))
    UI.empty()
  }),
})
