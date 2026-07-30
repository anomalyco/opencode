/** @jsxImportSource @opentui/solid */
import { DiffRenderable, LineNumberRenderable, type ColorInput } from "@opentui/core"
import type { JSX } from "@opentui/solid"
import { createMemo, For, Show, splitProps } from "solid-js"
import { splitPatchHunks } from "../util/diff"
import { stringWidth } from "../util/string-width"

type Props = Omit<JSX.IntrinsicElements["diff"], "diff" | "lineNumberBg"> & {
  diff: string
  hunkFg: ColorInput
  lineNumberBg: ColorInput
}

export function PatchDiff(props: Props) {
  const [local, diffProps] = splitProps(props, ["diff", "hunkFg", "lineNumberBg"])
  const hunks = createMemo(() => splitPatchHunks(local.diff))
  const nodes = new Set<DiffRenderable>()
  const syncGutters = (attempt = 0) => {
    requestAnimationFrame(() => {
      const sides = [...nodes]
        .filter((item) => !item.isDestroyed)
        .flatMap((item) => item.getChildren().filter((side) => side instanceof LineNumberRenderable))
      const lineNumbers = sides.map((side) => new Map([...side.getLineNumbers()].filter(([line]) => line >= 0)))
      const digits = lineNumbers.map((numbers) => Math.max(0, ...numbers.values()).toString().length)
      const after = sides.map((side) =>
        Math.max(
          0,
          ...[...side.getLineSigns()]
            .filter(([line]) => line >= 0)
            .map(([, sign]) => stringWidth(sign.after ?? "")),
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
  const register = (node: DiffRenderable) => {
    nodes.add(node)
    syncGutters()
  }

  return (
    <For each={hunks()}>
      {(hunk, index) => (
        <>
          <Show when={index() > 0}>
            <box width="100%" height={1} backgroundColor={local.lineNumberBg}>
              <text fg={local.hunkFg} bg={local.lineNumberBg}>
                {hunk.header ?? ""}
              </text>
            </box>
          </Show>
          <diff
            {...diffProps}
            ref={register}
            diff={hunk.patch}
            minHeight={hunk.rows}
            lineNumberBg={local.lineNumberBg}
          />
        </>
      )}
    </For>
  )
}
