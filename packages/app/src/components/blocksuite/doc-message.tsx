import { Component, createSignal, type JSX, onCleanup, onMount, Show } from "solid-js"
import { useSDK } from "@/context/sdk"
import { useServer } from "@/context/server"
import { createPage } from "./blocksuite-doc"
import type { DocSyncOpts } from "./opencode-doc-source"

function theme() {
  const scheme = document.documentElement.getAttribute("data-color-scheme")
  if (scheme === "dark" || scheme === "light") return scheme
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
}

export const DocMessage: Component<{ id: string; fallback?: JSX.Element }> = (props) => {
  const sdk = useSDK()
  const server = useServer()
  const [fail, setFail] = createSignal(false)
  let el: HTMLDivElement | undefined
  let page: Awaited<ReturnType<typeof createPage>> | undefined
  let stop = false

  const fetch: DocSyncOpts["fetch"] = (input, init) => {
    const http = server.current?.http
    if (!http) return globalThis.fetch(input, init)
    const headers = new Headers(init?.headers)
    if (http.password) headers.set("Authorization", `Basic ${btoa(`${http.username ?? "opencode"}:${http.password}`)}`)
    return globalThis.fetch(input, { ...init, headers })
  }

  onMount(() => {
    const host = el
    if (!host) {
      setFail(true)
      return
    }

    void createPage({
      theme,
      init: false,
      readonly: true,
      sync: {
        docID: props.id,
        baseUrl: sdk.url,
        directory: sdk.directory,
        fetch,
        actorID: "viewer",
        name: "Viewer",
        color: "#3574D9",
      },
    })
      .then(async (next) => {
        if (stop) {
          await next.dispose()
          return
        }
        page = next
        await next.attach(host)
      })
      .catch(() => {
        void page?.dispose()
        page = undefined
        setFail(true)
      })
  })

  onCleanup(() => {
    stop = true
    void page?.dispose()
  })

  return (
    <Show
      when={!fail()}
      fallback={props.fallback ?? <span data-component="prompt-doc-viewer-error">문서를 불러올 수 없습니다.</span>}
    >
      <div ref={el} data-component="prompt-doc-viewer" />
    </Show>
  )
}
