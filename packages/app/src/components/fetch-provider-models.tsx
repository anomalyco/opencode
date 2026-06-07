import { Button } from "@opencode-ai/ui/button"
import { Spinner } from "@opencode-ai/ui/spinner"
import { createEffect, createSignal, For, Show } from "solid-js"
import { usePlatform } from "@/context/platform"

type FetchedModel = { id: string }

type Props = {
  baseURL: string
  apiKey: string
  headers: Array<{ key: string; value: string }>
  existingModelIDs: Set<string>
  onAdd: (id: string, name: string) => void
}

export function FetchProviderModels(props: Props) {
  const platform = usePlatform()
  const [fetching, setFetching] = createSignal(false)
  const [models, setModels] = createSignal<FetchedModel[]>([])
  const [error, setError] = createSignal<string>()

  // Reset state when provider (baseURL) changes
  createEffect(() => {
    props.baseURL
    setModels([])
    setError(undefined)
  })

  const canFetch = () => !!props.baseURL.trim() && !!props.apiKey.trim()

  const fetchModels = async () => {
    if (!canFetch() || fetching()) return
    setFetching(true)
    setError(undefined)
    setModels([])

    try {
      const base = props.baseURL.trim().replace(/\/+$/, "")
      const reqHeaders: Record<string, string> = {
        Authorization: `Bearer ${props.apiKey.trim()}`,
      }
      for (const h of props.headers) {
        if (h.key.trim() && h.value.trim()) reqHeaders[h.key.trim()] = h.value.trim()
      }

      // Use fetchExternal to bypass Tauri's loopback routing restriction,
      // allowing requests to local AI servers (e.g. 127.0.0.1:8084) that
      // don't set CORS headers.
      const doFetch = platform.fetchExternal ?? fetch
      const res = await doFetch(`${base}/models`, { headers: reqHeaders })
      if (!res.ok) {
        setError(`HTTP ${res.status}: ${res.statusText}`)
        return
      }

      const json = await res.json()
      let list: FetchedModel[] = []
      if (Array.isArray(json)) {
        list = json.map((m: any) => ({ id: m.id ?? m.name ?? String(m) }))
      } else if (Array.isArray(json?.data)) {
        list = json.data.map((m: any) => ({ id: m.id ?? m.name ?? String(m) }))
      } else if (Array.isArray(json?.models)) {
        list = json.models.map((m: any) => ({ id: typeof m === "string" ? m : (m.id ?? m.name ?? String(m)) }))
      }
      list = list.filter((m) => !!m.id)
      setModels(list)
      if (list.length === 0) setError("未找到模型")
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setFetching(false)
    }
  }

  return (
    <div class="flex flex-col gap-2">
      <div class="flex items-center gap-2 flex-wrap">
        <Button
          type="button"
          size="small"
          variant="secondary"
          icon={fetching() ? undefined : "download"}
          onClick={() => void fetchModels()}
          disabled={!canFetch() || fetching()}
        >
          <Show when={fetching()}>
            <Spinner class="size-3" />
          </Show>
          {fetching() ? "获取中..." : "获取模型"}
        </Button>
        <Show when={error()}>
          <span class="text-12-regular text-text-danger-base">{error()}</span>
        </Show>
      </div>
      <Show when={models().length > 0}>
        <div class="flex flex-wrap gap-1.5">
          <For each={models()}>
            {(model) => {
              const added = () => props.existingModelIDs.has(model.id)
              return (
                <div
                  class="flex items-center gap-0.5 rounded-full bg-surface-secondary pl-2.5 pr-2.5 py-1 transition-colors"
                  classList={{
                    "opacity-40": added(),
                    "cursor-pointer hover:bg-surface-base-hover": !added(),
                  }}
                  onClick={() => !added() && props.onAdd(model.id, model.id)}
                >
                  <span class="text-12-regular text-text-base">{model.id}</span>
                  <Show when={!added()}>
                    <span class="text-12-regular text-text-weak ml-0.5">+</span>
                  </Show>
                  <Show when={added()}>
                    <span class="text-12-regular text-text-weak ml-0.5">✓</span>
                  </Show>
                </div>
              )
            }}
          </For>
        </div>
      </Show>
    </div>
  )
}
