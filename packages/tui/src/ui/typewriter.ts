import { createEffect, on, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { useConfig } from "../config"

// Retypes a string like a typewriter whenever the source changes. The initial
// value renders immediately; only subsequent changes animate. While `active`,
// callers should render a cursor and a brighter style, then settle back down.
export function createTypewriter(source: () => string | undefined) {
  const config = useConfig().data
  const [store, setStore] = createStore({
    text: source(),
    active: false,
  })
  createEffect(
    on(
      source,
      (text) => {
        if (text === undefined || !(config.animations ?? true)) {
          setStore({ text, active: false })
          return
        }
        const timeouts: ReturnType<typeof setTimeout>[] = []
        setStore({ text: "", active: true })
        let i = 0
        const type = () => {
          if (i < text.length) {
            i++
            setStore("text", text.slice(0, i))
            timeouts.push(setTimeout(type, Math.random() < 0.1 ? 40 + Math.random() * 40 : 8 + Math.random() * 18))
            return
          }
          timeouts.push(setTimeout(() => setStore("active", false), 1200))
        }
        timeouts.push(setTimeout(type, 120))
        onCleanup(() => timeouts.forEach(clearTimeout))
      },
      { defer: true },
    ),
  )
  return store
}
