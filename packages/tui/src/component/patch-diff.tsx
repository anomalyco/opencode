/** @jsxImportSource @opentui/solid */
import { DiffRenderable, LineNumberRenderable, type ColorInput } from "@opentui/core"
import type { JSX } from "@opentui/solid"
import { createMemo, For, Show, splitProps } from "solid-js"
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
  local.ref?.({
    hunks: () =>
      [...nodes.entries()]
        .sort(([left], [right]) => left - right)
        .map(([, node]) => node)
        .filter((node) => !node.isDestroyed),
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
      sides.forEach((side) => {
        const index = sides.indexOf(side)
        const signs = new Map([...side.getLineSigns()].filter(([line]) => line >= 0))
        signs.set(-1, { after: " ".repeat(maxAfter + maxDigits - digits[index]) })
        side.setLineNumbers(lineNumbers[index])
        side.setLineSigns(signs)
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
