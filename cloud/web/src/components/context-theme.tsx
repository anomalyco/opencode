import { createStore } from "solid-js/store"
import { makePersisted } from "@solid-primitives/storage"
import { createEffect } from "solid-js"
import { createInitializedContext } from "../util/context"
import { isServer } from "solid-js/web"

interface Storage {
  mode: "light" | "dark"
}

export const { provider: ThemeProvider, use: useTheme } =
  createInitializedContext("ThemeContext", () => {
    const [store, setStore] = makePersisted(
      createStore<Storage>({
        mode:
          !isServer &&
          window.matchMedia &&
          window.matchMedia("(prefers-color-scheme: dark)").matches
            ? "dark"
            : "light",
      }),
      {
        name: "theme",
      },
    )
    createEffect(() => {
      document.documentElement.setAttribute("data-color-mode", store.mode)
    })

    return {
      setMode(mode: Storage["mode"]) {
        setStore("mode", mode)
      },
      get mode() {
        return store.mode
      },
      ready: true,
    }
  })
