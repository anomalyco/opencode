/** @jsxImportSource @opentui/solid */
import {
  BoxRenderable,
  DiffRenderable,
  LineNumberRenderable,
  type ColorInput,
  type ScrollBoxRenderable,
} from "@opentui/core"
import type { JSX } from "@opentui/solid"
import { useRenderer } from "@opentui/solid"
import { createEffect, createMemo, createSignal, For, onCleanup, Show, splitProps } from "solid-js"
import { splitAddedPatch, splitPatchHunks, type AddedPatchChunk } from "../util/diff"
import { stringWidth } from "../util/string-width"

export interface PatchDiffRef {
  readonly hunks: () => readonly (DiffRenderable | BoxRenderable)[]
}

// Smaller patches render fine as a single DiffRenderable; only split files large enough to stall the TUI.
const VIRTUAL_MIN_LINES = 1000
const VIRTUAL_CHUNK_LINES = 128

type Props = Omit<JSX.IntrinsicElements["diff"], "diff" | "lineNumberBg" | "ref"> & {
  diff: string
  hunkFg: ColorInput
  lineNumberBg: ColorInput
  ref?: (value: PatchDiffRef) => void
  scroll?: () => ScrollBoxRenderable | undefined
  viewportWidth?: number
}

export function PatchDiff(props: Props) {
  const [local, diffProps] = splitProps(props, ["diff", "hunkFg", "lineNumberBg", "ref", "scroll", "viewportWidth"])
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
          width={local.viewportWidth ?? 80}
          digits={minDigits()}
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

function VirtualAddedPatch(props: {
  chunks: readonly AddedPatchChunk[]
  width: number
  digits: number
  scroll: () => ScrollBoxRenderable | undefined
  diffProps: Omit<JSX.IntrinsicElements["diff"], "diff" | "lineNumberBg" | "ref">
  lineNumberBg: ColorInput
  register: (index: number, node: DiffRenderable) => void
  registerRoot: (root: BoxRenderable) => void
}) {
  const renderer = useRenderer()
  const [visible, setVisible] = createSignal(0)
  const [measured, setMeasured] = createSignal<ReadonlyMap<number, number>>(new Map())
  createEffect(() => {
    props.width
    props.chunks
    setMeasured(new Map())
  })
  // Offscreen chunks need heights for scroll jumps before OpenTUI has measured them.
  // Replace those estimates with actual rendered heights as chunks enter the viewport.
  const estimates = createMemo(() => {
    const codeWidth = Math.max(1, props.width - props.digits - 5)
    return props.chunks.map((chunk) =>
      chunk.lines.reduce((height, line) => height + Math.max(1, Math.ceil(stringWidth(line.slice(1)) / codeWidth)), 0),
    )
  })
  const heights = createMemo(() => estimates().map((estimate, index) => measured().get(index) ?? estimate))
  let root: BoxRenderable | undefined
  // Viewport top relative to this patch, in rows.
  const viewportTop = (scroll: ScrollBoxRenderable, root: BoxRenderable) =>
    scroll.scrollTop - (root.y - scroll.content.y)

  return (
    <box
      width="100%"
      ref={(node: BoxRenderable) => {
        root = node
        props.registerRoot(node)
        node.onLifecyclePass = () => {
          const scroll = props.scroll()
          if (!scroll) return
          // ScrollBox's scroll position is not a Solid signal; observe it during the render pass.
          const top = viewportTop(scroll, node)
          const sizes = heights()
          if (top + scroll.viewport.height < 0 || top > sizes.reduce((sum, height) => sum + height, 0)) {
            setVisible(-1)
            return
          }
          let position = 0
          const index = sizes.findIndex((height) => (position += height) > top)
          setVisible(index < 0 ? sizes.length - 1 : index)
        }
        renderer.registerLifecyclePass(node)
        onCleanup(() => renderer.unregisterLifecyclePass(node))
      }}
    >
      <For each={props.chunks}>
        {(chunk, index) => (
          <Show
            when={visible() >= 0 && Math.abs(index() - visible()) <= 2}
            fallback={<box height={heights()[index()]} />}
          >
            <diff
              {...props.diffProps}
              ref={(node: DiffRenderable) => {
                props.register(index(), node)
                node.onSizeChange = () => {
                  if (node.height <= 0 || measured().get(index()) === node.height) return
                  const scroll = props.scroll()
                  const sizes = heights()
                  const delta = node.height - sizes[index()]
                  const bottom = sizes.slice(0, index() + 1).reduce((sum, height) => sum + height, 0)
                  const above = scroll && root && bottom <= viewportTop(scroll, root)
                  const atEnd = scroll && scroll.scrollTop >= scroll.scrollHeight - scroll.viewport.height - 1
                  setMeasured((known) => new Map(known).set(index(), node.height))
                  // Keep G pinned to the end when a newly mounted chunk changes total height.
                  if (atEnd) requestAnimationFrame(() => scroll.scrollTo(Infinity))
                  // A chunk fully above the viewport grew or shrank; shift by the same amount so visible rows stay put.
                  if (!atEnd && above && delta) scroll.scrollTo(scroll.scrollTop + delta)
                }
              }}
              diff={chunk.patch}
              lineNumberBg={props.lineNumberBg}
            />
          </Show>
        )}
      </For>
    </box>
  )
}

function lineCount(chunks: readonly AddedPatchChunk[]) {
  return chunks.reduce((count, chunk) => count + chunk.rows, 0)
}
