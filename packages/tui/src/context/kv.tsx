import { createEffect, createSignal, type Setter } from "solid-js"
import { createStore, unwrap } from "solid-js/store"
import { createSimpleContext } from "./helper"
import { Flock } from "@opencode-ai/core/util/flock"
import { Global } from "@opencode-ai/core/global"
import { readJson, writeJsonAtomic } from "../util/persistence"
import { useTuiPaths } from "./runtime"
import path from "path"
import { useConfigOptional, type Config } from "../config"

export const { use: useKV, provider: KVProvider } = createSimpleContext({
  name: "KV",
  init: (props: { config?: Config.Info }) => {
    const config = props.config ?? useConfigOptional()?.data
    const paths = useTuiPaths()
    void Global.Path.state
    const file = path.join(paths.state, "kv.json")
    const lock = `tui-kv:${file}`
    const [ready, setReady] = createSignal(false)
    const [store, setStore] = createStore<Record<string, any>>()
    // Queue same-process writes so rapid updates persist in order.
    let write = Promise.resolve()

    Flock.withLock(lock, () => readJson<Record<string, unknown>>(file))
      .then((x) => {
        const values: Record<string, any> = { ...x }
        Object.entries(configValues(config ?? {})).forEach(([key, value]) => {
          if (value === undefined) delete values[key]
          else values[key] = value
        })
        setStore(values)
      })
      .catch((error) => {
        console.error("Failed to read KV state", { error })
      })
      .finally(() => {
        setReady(true)
      })

    createEffect(() => {
      if (!ready() || !config) return
      Object.entries(configValues(config)).forEach(([key, value]) => {
        if (value === undefined) setStore(key, undefined)
        else setStore(key, value)
      })
    })

    const result = {
      get ready() {
        return ready()
      },
      get store() {
        return store
      },
      signal<T>(name: string, defaultValue: T) {
        if (store[name] === undefined) setStore(name, defaultValue)
        return [
          function () {
            return result.get(name)
          },
          function setter(next: Setter<T>) {
            result.set(name, next)
          },
        ] as const
      },
      get(key: string, defaultValue?: any) {
        return store[key] ?? defaultValue
      },
      set(key: string, value: any) {
        setStore(key, value)
        const snapshot = structuredClone(unwrap(store))
        write = write
          .then(() => Flock.withLock(lock, () => writeJsonAtomic(file, snapshot)))
          .catch((error) => {
            console.error("Failed to write KV state", { error })
          })
      },
    }
    return result
  },
})

function configValues(config: Config.Info) {
  const values: Record<string, any> = {}
  if (config.theme?.name !== undefined) values.theme = config.theme.name
  if (config.theme?.mode !== undefined) {
    values.theme_mode_lock = config.theme.mode === "system" ? undefined : config.theme.mode
    values.theme_mode = undefined
  }
  if (config.attention?.sound_pack !== undefined) values.attention_sound_pack = config.attention.sound_pack
  if (config.diffs?.wrap !== undefined) values.diff_wrap_mode = config.diffs.wrap
  if (config.diffs?.tree !== undefined) values.diff_viewer_show_file_tree = config.diffs.tree
  if (config.diffs?.single !== undefined) values.diff_viewer_single_patch = config.diffs.single
  if (config.diffs?.view !== undefined)
    values.diff_viewer_view = config.diffs.view === "auto" ? undefined : config.diffs.view
  if (config.terminal?.title !== undefined) values.terminal_title_enabled = config.terminal.title
  if (config.prompt?.editor !== undefined) values.file_context_enabled = config.prompt.editor
  if (config.prompt?.paste !== undefined) values.paste_summary_enabled = config.prompt.paste === "compact"
  if (config.session?.sidebar !== undefined) values.sidebar = config.session.sidebar
  if (config.session?.scrollbar !== undefined) values.scrollbar_visible = config.session.scrollbar
  if (config.session?.thinking !== undefined) values.thinking_mode = config.session.thinking
  if (config.session?.grouping !== undefined) values.exploration_grouping = config.session.grouping === "auto"
  if (config.hints?.tips !== undefined) values.tips_hidden = !config.hints.tips
  if (config.hints?.onboarding !== undefined) values.dismissed_getting_started = !config.hints.onboarding
  if (config.animations !== undefined) values.animations_enabled = config.animations
  return values
}
