import { createMemo } from "solid-js"
import { AnimatedNumber } from "./animated-number"
import { commonPrefix } from "./text-utils"

function split(text: string) {
  const match = /{{\s*count\s*}}/.exec(text)
  if (!match) return { before: "", after: text }
  if (match.index === undefined) return { before: "", after: text }
  return {
    before: text.slice(0, match.index),
    after: text.slice(match.index + match[0].length),
  }
}

export function AnimatedCountLabel(props: { count: number; one: string; other: string; class?: string }) {
  const one = createMemo(() => split(props.one))
  const other = createMemo(() => split(props.other))
  const singular = createMemo(() => Math.round(props.count) === 1)
  const active = createMemo(() => (singular() ? one() : other()))
  const suffix = createMemo(() => commonPrefix(one().after, other().after))
  const splitSuffix = createMemo(
    () =>
      one().before === other().before &&
      (one().after.startsWith(other().after) || other().after.startsWith(one().after)),
  )
  const before = createMemo(() => (splitSuffix() ? one().before : active().before))
  const stem = createMemo(() => (splitSuffix() ? suffix().prefix : active().after))
  const tail = createMemo(() => {
    if (!splitSuffix()) return ""
    if (singular()) return suffix().aSuffix
    return suffix().bSuffix
  })
  const showTail = createMemo(() => splitSuffix() && tail().length > 0)

  return (
    <span data-component="tool-count-label" class={props.class}>
      <span data-slot="tool-count-label-before">{before()}</span>
      <AnimatedNumber value={props.count} />
      <span data-slot="tool-count-label-word">
        <span data-slot="tool-count-label-stem">{stem()}</span>
        <span data-slot="tool-count-label-suffix" data-active={showTail() ? "true" : "false"}>
          <span data-slot="tool-count-label-suffix-inner">{tail()}</span>
        </span>
      </span>
    </span>
  )
}
