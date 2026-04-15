import { createMemo, type ValidComponent } from "solid-js"
import { Dynamic } from "solid-js/web"

export const TextShimmer = <T extends ValidComponent = "span">(props: {
  text: string
  class?: string
  as?: T
  active?: boolean
  offset?: number
}) => {
  const text = createMemo(() => props.text ?? "")

  return (
    <Dynamic component={props.as ?? "span"} data-component="text-shimmer" class={props.class}>
      {text()}
    </Dynamic>
  )
}
