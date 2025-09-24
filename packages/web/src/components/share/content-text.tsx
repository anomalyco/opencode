import style from "./content-text.module.css"
import { createSignal } from "solid-js"
import { createOverflow } from "./common"
import { CopyButton } from "./copy-button"

interface Props {
  text: string
  expand?: boolean
  compact?: boolean
}
export function ContentText(props: Props) {
  const [expanded, setExpanded] = createSignal(false)
  const overflow = createOverflow()

  return (
    <div
      class={style.root}
      data-expanded={expanded() || props.expand === true ? true : undefined}
      data-compact={props.compact === true ? true : undefined}
    >
      <pre data-slot="text" ref={overflow.ref}>
        {props.text}
      </pre>
      {((!props.expand && overflow.status) || expanded()) && (
        <button
          type="button"
          data-component="text-button"
          data-slot="expand-button"
          onClick={() => setExpanded((e) => !e)}
        >
          {expanded() ? "Show less" : "Show more"}
        </button>
      )}
      <CopyButton text={props.text} />
    </div>
  )
}
