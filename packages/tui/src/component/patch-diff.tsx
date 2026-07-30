/** @jsxImportSource @opentui/solid */
import type { ColorInput } from "@opentui/core"
import type { JSX } from "@opentui/solid"
import { createMemo, For, Show, splitProps } from "solid-js"
import { splitPatchHunks } from "../util/diff"

type Props = Omit<JSX.IntrinsicElements["diff"], "diff"> & {
  diff: string
  hunkBg: ColorInput
  hunkFg: ColorInput
}

export function PatchDiff(props: Props) {
  const [local, diffProps] = splitProps(props, ["diff", "hunkBg", "hunkFg"])
  const hunks = createMemo(() => splitPatchHunks(local.diff))

  return (
    <For each={hunks()}>
      {(hunk, index) => (
        <>
          <Show when={index() > 0}>
            <text width="100%" height={1} fg={local.hunkFg} bg={local.hunkBg}>
              {hunk.header ?? ""}
            </text>
          </Show>
          <diff {...diffProps} diff={hunk.patch} minHeight={hunk.rows} />
        </>
      )}
    </For>
  )
}
