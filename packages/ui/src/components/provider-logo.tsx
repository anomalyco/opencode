import { Show, createSignal, splitProps } from "solid-js"
import type { Component, JSX } from "solid-js"
import { ProviderIcon } from "./provider-icon"

export type ProviderLogoProps = Omit<JSX.ImgHTMLAttributes<HTMLImageElement>, "src" | "alt"> & {
  id: string
}

export const ProviderLogo: Component<ProviderLogoProps> = (props) => {
  const [local, rest] = splitProps(props, ["id", "class", "classList"])
  const [failed, setFailed] = createSignal(false)
  return (
    <Show when={!failed()} fallback={<ProviderIcon id={local.id} class={local.class} classList={local.classList} />}>
      <img
        {...rest}
        data-component="provider-logo"
        src={`https://models.dev/logos/${local.id}.svg`}
        class={local.class}
        classList={local.classList}
        loading="lazy"
        alt=""
        onError={() => setFailed(true)}
      />
    </Show>
  )
}