import type { ComponentProps } from "solid-js"
import wordmark from "../../assets/brand/jarvis-wordmark.png"

export function WordmarkV2(props: Pick<ComponentProps<"img">, "class">) {
  return (
    <img
      data-component="wordmark-v2"
      src={wordmark}
      alt="Jarvis"
      draggable={false}
      class="object-contain select-none"
      classList={{ [props.class ?? ""]: !!props.class }}
    />
  )
}
