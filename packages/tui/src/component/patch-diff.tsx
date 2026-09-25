/** @jsxImportSource @opentui/solid */
import {
  BoxRenderable,
  CodeRenderable,
  DiffRenderable,
  getTreeSitterClient,
  LineNumberRenderable,
  type ColorInput,
  type OnHighlightCallback,
  type Renderable,
  type ScrollBoxRenderable,
  type SimpleHighlight,
} from "@opentui/core"
import type { JSX } from "@opentui/solid"
import { useRenderer } from "@opentui/solid"
import { createMemo, createSignal, For, onCleanup, Show, splitProps } from "solid-js"
import { splitAddedPatch, splitPatchHunks, type AddedPatchChunk } from "../util/diff"
import { stringWidth } from "../util/string-width"

export interface PatchDiffRef {
  readonly hunks: () => readonly (DiffRenderable | BoxRenderable)[]
}

// Smaller patches render fine as a single DiffRenderable; only split files large enough to stall the TUI.
const VIRTUAL_MIN_LINES = 3000
const VIRTUAL_CHUNK_LINES = 384

type Props = Omit<JSX.IntrinsicElements["diff"], "diff" | "lineNumberBg" | "ref"> & {
  diff: string
  hunkFg: ColorInput
  lineNumberBg: ColorInput
  ref?: (value: PatchDiffRef) => void
  scroll?: () => ScrollBoxRenderable | undefined
}

export function PatchDiff(props: Props) {
  const [local, diffProps] = splitProps(props, ["diff", "hunkFg", "lineNumberBg", "ref", "scroll"])
  const hunks = createMemo(() => splitPatchHunks(local.diff))
  const chunks = createMemo(() => {
    if (!local.scroll) return
    const result = splitAddedPatch(local.diff, VIRTUAL_CHUNK_LINES)
    return result && lineCount(result) > VIRTUAL_MIN_LINES ? result : undefined
  })
  // Virtual chunks mount independently, so size the gutter for the whole file rather than the mounted chunks.
  const minDigits = createMemo(() => {
    const items = chunks()
    return items ? String(lineCount(items)).length : 0
  })
  const nodes = new Map<number, DiffRenderable>()
  let virtualRoot: BoxRenderable | undefined
  local.ref?.({
    hunks: () => {
      if (chunks()) return virtualRoot && !virtualRoot.isDestroyed ? [virtualRoot] : []
      return [...nodes.entries()]
        .sort(([left], [right]) => left - right)
        .map(([, node]) => node)
        .filter((node) => !node.isDestroyed)
    },
  })
  const syncGutters = (attempt = 0) => {
    requestAnimationFrame(() => {
      const sides = [...nodes.values()]
        .filter((item) => !item.isDestroyed)
        .flatMap((item) => item.getChildren().filter((side) => side instanceof LineNumberRenderable))
      const lineNumbers = sides.map((side) => new Map([...side.getLineNumbers()].filter(([line]) => line >= 0)))
      const digits = lineNumbers.map((numbers) => Math.max(0, ...numbers.values()).toString().length)
      const after = sides.map((side) =>
        Math.max(
          0,
          ...[...side.getLineSigns()].filter(([line]) => line >= 0).map(([, sign]) => stringWidth(sign.after ?? "")),
        ),
      )
      const maxDigits = Math.max(...digits)
      const maxAfter = Math.max(...after)
      if (!maxDigits && attempt < 2) return syncGutters(attempt + 1)
      if (!maxDigits) return
      const width = Math.max(maxDigits, minDigits())
      sides.forEach((side) => {
        const index = sides.indexOf(side)
        const signs = new Map([...side.getLineSigns()].filter(([line]) => line >= 0))
        signs.set(-1, { after: " ".repeat(maxAfter + width - digits[index]) })
        side.setLineNumbers(lineNumbers[index])
        side.setLineSigns(signs)
      })
    })
  }
  const register = (index: number, node: DiffRenderable) => {
    nodes.set(index, node)
    onCleanup(() => nodes.delete(index))
    syncGutters()
  }

  return (
    <Show
      when={chunks()}
      fallback={
        <For each={hunks()}>
          {(hunk, index) => (
            <>
              <Show when={index() > 0}>
                <box width="100%" height={1} backgroundColor={local.lineNumberBg}>
                  <text fg={local.hunkFg} bg={local.lineNumberBg}>
                    {` ${hunk.header ?? ""}`}
                  </text>
                </box>
              </Show>
              <diff
                {...diffProps}
                ref={(node: DiffRenderable) => register(index(), node)}
                diff={hunk.patch}
                minHeight={hunk.rows}
                lineNumberBg={local.lineNumberBg}
              />
            </>
          )}
        </For>
      }
    >
      {(items) => (
        <VirtualAddedPatch
          chunks={items()}
          scroll={local.scroll!}
          diffProps={diffProps}
          lineNumberBg={local.lineNumberBg}
          register={register}
          registerRoot={(root) => (virtualRoot = root)}
        />
      )}
    </Show>
  )
}

// Chunks render without wrapping so each one is exactly `rows` tall. Offscreen chunks become fixed-height
// placeholders, and the visible chunk follows directly from the scroll offset.
function VirtualAddedPatch(props: {
  chunks: readonly AddedPatchChunk[]
  scroll: () => ScrollBoxRenderable | undefined
  diffProps: Omit<JSX.IntrinsicElements["diff"], "diff" | "lineNumberBg" | "ref">
  lineNumberBg: ColorInput
  register: (index: number, node: DiffRenderable) => void
  registerRoot: (root: BoxRenderable) => void
}) {
  const renderer = useRenderer()
  const [visible, setVisible] = createSignal(0)
  // A chunk is not valid source on its own (a slice of a JSON object parses as an error), so highlight
  // the whole file once and give each chunk its slice of the result.
  const contents = createMemo(() => props.chunks.map((chunk) => chunk.lines.map((line) => line.slice(1)).join("\n")))
  const offsets = createMemo(() =>
    contents().map((_, index, all) => all.slice(0, index).reduce((sum, content) => sum + content.length + 1, 0)),
  )
  const fileHighlights = createMemo(() => {
    const filetype = props.diffProps.filetype
    if (!filetype) return
    return (
      getTreeSitterClient()
        .highlightOnce(contents().join("\n"), filetype)
        .then((result) => result.highlights)
        // Rejects when the renderer tears down the client mid-parse; chunks then keep their own highlights.
        .catch(() => undefined)
    )
  })
  const chunkHighlights =
    (index: number): OnHighlightCallback =>
    async () => {
      const all = await fileHighlights()
      if (!all) return
      const start = offsets()[index]
      const end = start + contents()[index].length
      return all.flatMap((highlight): SimpleHighlight[] =>
        highlight[0] < end && highlight[1] > start
          ? [[Math.max(highlight[0], start) - start, Math.min(highlight[1], end) - start, highlight[2], highlight[3]]]
          : [],
      )
    }

  return (
    <box
      width="100%"
      ref={(root: BoxRenderable) => {
        props.registerRoot(root)
        root.onLifecyclePass = () => {
          const scroll = props.scroll()
          if (!scroll) return
          // ScrollBox's scroll position is not a Solid signal; observe it during the render pass.
          const top = scroll.scrollTop - (root.y - scroll.content.y)
          if (top + scroll.viewport.height < 0 || top > lineCount(props.chunks)) return setVisible(-1)
          setVisible(Math.min(props.chunks.length - 1, Math.max(0, Math.floor(top / VIRTUAL_CHUNK_LINES))))
        }
        renderer.registerLifecyclePass(root)
        onCleanup(() => renderer.unregisterLifecyclePass(root))
      }}
    >
      <For each={props.chunks}>
        {(chunk, index) => (
          <Show when={visible() >= 0 && Math.abs(index() - visible()) <= 1} fallback={<box height={chunk.rows} />}>
            <diff
              {...props.diffProps}
              ref={(node: DiffRenderable) => {
                props.register(index(), node)
                // DiffRenderable creates its CodeRenderable after ref runs; setting onHighlight re-highlights.
                queueMicrotask(() => {
                  const code = findCode(node)
                  if (code) code.onHighlight = chunkHighlights(index())
                })
              }}
              diff={chunk.patch}
              wrapMode="none"
              height={chunk.rows}
              lineNumberBg={props.lineNumberBg}
            />
          </Show>
        )}
      </For>
    </box>
  )
}

function findCode(node: Renderable): CodeRenderable | undefined {
  if (node instanceof CodeRenderable) return node
  return node.getChildren().reduce<CodeRenderable | undefined>((found, child) => found ?? findCode(child), undefined)
}

function lineCount(chunks: readonly AddedPatchChunk[]) {
  return chunks.reduce((count, chunk) => count + chunk.rows, 0)
}
