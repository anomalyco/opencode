import { createEffect, Show, type ValidComponent } from "solid-js"
import { createStore } from "solid-js/store"
import { Dynamic } from "solid-js/web"

export const Typewriter = <T extends ValidComponent = "p">(props: { text?: string; class?: string; as?: T }) => {
  const [store, setStore] = createStore({
    typing: false,
    displayed: "",
    cursor: true,
  })

  createEffect(() => {
    const text = props.text
    if (!text) return

    let i = 0
    setStore("typing", true)
    setStore("displayed", "")
    setStore("cursor", true)

    const getTypingDelay = () => {
      const random = Math.random()
      if (random < 0.05) return 150 + Math.random() * 100
      if (random < 0.15) return 80 + Math.random() * 60
      return 30 + Math.random() * 50
    }

    const type = () => {
      if (i < text.length) {
        setStore("displayed", text.slice(0, i + 1))
        i++
        setTimeout(type, getTypingDelay())
      } else {
        setStore("typing", false)
        setTimeout(() => setStore("cursor", false), 2000)
      }
    }

    setTimeout(type, 200)
  })

  return (
    <Dynamic component={props.as || "p"} class={props.class}>
      {store.displayed}
      <Show when={store.cursor}>
        <span classList={{ "blinking-cursor": !store.typing }}>│</span>
      </Show>
    </Dynamic>
  )
}
