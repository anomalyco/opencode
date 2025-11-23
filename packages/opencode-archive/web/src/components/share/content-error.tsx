import style from "./content-error.module.css"
import { type JSX, createSignal } from "solid-js"
import { createOverflow } from "./common"

interface Props extends JSX.HTMLAttributes<HTMLDivElement> {
  expand?: boolean
}
export function ContentError(props: Props) {
  const [expanded, setExpanded] = createSignal(false)
  const overflow = createOverflow()

  return (
    <div class={style.root} data-expanded={expanded() || props.expand === true ? true : undefined}>
      <div data-section="content" ref={overflow.ref}>
        {props.children}
      </div>
      {((!props.expand && overflow.status) || expanded()) && (
        <button type="button" data-element-button-text onClick={() => setExpanded((e) => !e)}>
          {expanded() ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  )
}
