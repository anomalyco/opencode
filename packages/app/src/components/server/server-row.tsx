import { Tooltip } from "@opencode-ai/ui/tooltip"
import {
  children,
  createEffect,
  createMemo,
  createSignal,
  type JSXElement,
  onCleanup,
  onMount,
  type ParentProps,
  Show,
} from "solid-js"
import { type ServerConnection, serverName } from "@/context/server"
import type { ServerHealth } from "@/utils/server-health"

interface ServerRowProps extends ParentProps {
  conn: ServerConnection.Any
  status?: ServerHealth
  class?: string
  nameClass?: string
  versionClass?: string
  dimmed?: boolean
  badge?: JSXElement
  showCredentials?: boolean
}

export function ServerRow(props: ServerRowProps) {
  const [truncated, setTruncated] = createSignal(false)
  let nameRef: HTMLSpanElement | undefined
  let versionRef: HTMLSpanElement | undefined
  const name = createMemo(() => serverName(props.conn))

  const check = () => {
    const nameTruncated = nameRef ? nameRef.scrollWidth > nameRef.clientWidth : false
    const versionTruncated = versionRef ? versionRef.scrollWidth > versionRef.clientWidth : false
    setTruncated(nameTruncated || versionTruncated)
  }

  createEffect(() => {
    name()
    props.conn.http.url
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
      <span>{serverName(props.conn, true)}</span>
      <Show when={props.status?.version}>
        <span class="text-text-invert-weak">v{props.status?.version}</span>
      </Show>
    </span>
  )

  const badge = children(() => props.badge)

  return (
    <Tooltip
      class="flex-1"
      value={tooltipValue()}
      placement="top-start"
      inactive={!truncated() && !props.conn.displayName}
    >
      <div class={props.class} classList={{ "opacity-50": props.dimmed }}>
        <div class="flex flex-col items-start">
          <div class="flex flex-row items-center gap-2">
            <span ref={nameRef} class={props.nameClass ?? "truncate"}>
              {name()}
            </span>
            <Show
              when={badge()}
              fallback={
                <Show when={props.status?.version}>
                  <span ref={versionRef} class={props.versionClass ?? "text-text-weak text-14-regular truncate"}>
                    v{props.status?.version}
                  </span>
                </Show>
              }
            >
              {(badge) => badge()}
            </Show>
          </div>
          <Show when={props.showCredentials && props.conn.type === "http" && props.conn}>
            {(conn) => (
              <div class="flex flex-row gap-3">
                <span>
                  {conn().http.username ? (
                    <span class="text-text-weak">{conn().http.username}</span>
                  ) : (
                    <span class="text-text-weaker">no username</span>
                  )}
                </span>
                {conn().http.password && <span class="text-text-weak">••••••••</span>}
              </div>
            )}
          </Show>
        </div>
        {props.children}
      </div>
    </Tooltip>
  )
}

export function ServerHealthIndicator(props: { health?: ServerHealth }) {
  return (
    <div
      classList={{
        "size-1.5 rounded-full shrink-0": true,
        "bg-icon-success-base": props.health?.healthy === true,
        "bg-icon-critical-base": props.health?.healthy === false,
        "bg-border-weak-base": props.health === undefined,
      }}
    />
  )
}
