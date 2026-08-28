/** @jsxImportSource @opentui/solid */
import { DiffRenderable, LineNumberRenderable, type ColorInput } from "@opentui/core"
import type { JSX } from "@opentui/solid"
import { createMemo, For, onCleanup, Show, splitProps } from "solid-js"
import { splitPatchHunks } from "../util/diff"
import { stringWidth } from "../util/string-width"

export interface PatchDiffRef {
  readonly hunks: () => readonly DiffRenderable[]
}

type Props = Omit<JSX.IntrinsicElements["diff"], "diff" | "lineNumberBg" | "ref"> & {
  diff: string
  hunkFg: ColorInput
  lineNumberBg: ColorInput
  ref?: (value: PatchDiffRef) => void
}

export function PatchDiff(props: Props) {
  const [local, diffProps] = splitProps(props, ["diff", "hunkFg", "lineNumberBg", "ref"])
  const hunks = createMemo(() => splitPatchHunks(local.diff))
  const nodes = new Map<number, DiffRenderable>()
  let gutterFrame: number | undefined
  onCleanup(() => {
    if (gutterFrame !== undefined) cancelAnimationFrame(gutterFrame)
  })
  local.ref?.({
    hunks: () =>
      [...nodes.entries()]
        .sort(([left], [right]) => left - right)
        .map(([, node]) => node)
        .filter((node) => !node.isDestroyed),
  })
  const syncGutters = (attempt = 0) => {
    // Registrations share one whole-file pass instead of repeating it for every hunk.
    if (gutterFrame !== undefined) return
    gutterFrame = requestAnimationFrame(() => {
      gutterFrame = undefined
      const sides = [...nodes.values()]
        .filter((item) => !item.isDestroyed)
        .flatMap((item) => item.getChildren().filter((side) => side instanceof LineNumberRenderable))
      const widths = sides.map((side) => {
        const width = { line: 0, sign: 0 }
        side.getLineNumbers().forEach((number, line) => {
          if (line >= 0) width.line = Math.max(width.line, number)
        })
        side.getLineSigns().forEach((sign, line) => {
          if (line >= 0) width.sign = Math.max(width.sign, stringWidth(sign.after ?? ""))
        })
        return { digits: width.line.toString().length, after: width.sign }
      })
      const max = widths.reduce(
        (max, width) => ({ digits: Math.max(max.digits, width.digits), after: Math.max(max.after, width.after) }),
        { digits: 0, after: 0 },
      )
      if (!max.digits && attempt < 2) return syncGutters(attempt + 1)
      if (!max.digits) return
      sides.forEach((side, index) => {
        side.setLineSign(-1, { after: " ".repeat(max.after + max.digits - widths[index].digits) })
      })
    })
  }
  const register = (index: number, node: DiffRenderable) => {
    nodes.set(index, node)
    syncGutters()
  }

  return (
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
  )
}
