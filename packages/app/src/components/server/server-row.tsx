import { Tooltip } from "@opencode-ai/ui/tooltip"
import { JSXElement, ParentProps, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { serverDisplayName } from "@/context/server"
import type { ServerHealth } from "@/utils/server-health"

interface ServerRowProps extends ParentProps {
  url: string
  status?: ServerHealth
  class?: string
  nameClass?: string
  versionClass?: string
  dimmed?: boolean
  badge?: JSXElement
}

export function ServerRow(props: ServerRowProps) {
  const [truncated, setTruncated] = createSignal(false)
  let nameRef: HTMLSpanElement | undefined
  let versionRef: HTMLSpanElement | undefined
  const name = createMemo(() => serverDisplayName(props.url))

  const check = () => {
    const nameTruncated = nameRef ? nameRef.scrollWidth > nameRef.clientWidth : false
    const versionTruncated = versionRef ? versionRef.scrollWidth > versionRef.clientWidth : false
    setTruncated(nameTruncated || versionTruncated)
  }

  createEffect(() => {
    name()
    props.url
    props.status?.version
    queueMicrotask(check)
  })

  onMount(() => {
    check()
    if (typeof ResizeObserver !== "function") return
    const observer = new ResizeObserver(check)
    if (nameRef) observer.observe(nameRef)
    if (versionRef) observer.observe(versionRef)
    onCleanup(() => observer.disconnect())
  })

  const tooltipValue = () => (
    <span class="flex items-center gap-2">
      <span>{name()}</span>
      <Show when={props.status?.version}>
        <span class="text-text-invert-base">{props.status?.version}</span>
      </Show>
    </span>
  )

  return (
    <Tooltip value={tooltipValue()} placement="top" inactive={!truncated()}>
      <div class={props.class} classList={{ "opacity-50": props.dimmed }}>
        <div
          classList={{
            "size-1.5 rounded-full shrink-0": true,
            "bg-icon-success-base": props.status?.healthy === true,
            "bg-icon-critical-base": props.status?.healthy === false,
            "bg-border-weak-base": props.status === undefined,
          }}
        />
        <span ref={nameRef} class={props.nameClass ?? "truncate"}>
          {name()}
        </span>
        <Show when={props.status?.version}>
          <span ref={versionRef} class={props.versionClass ?? "text-text-weak text-14-regular truncate"}>
            {props.status?.version}
          </span>
        </Show>
        {props.badge}
        {props.children}
      </div>
    </Tooltip>
  )
}
