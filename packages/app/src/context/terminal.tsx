import { createStore, produce } from "solid-js/store"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { batch, createMemo } from "solid-js"
import { useParams } from "@solidjs/router"
import { useSDK } from "./sdk"
import { Persist, persisted } from "@/utils/persist"

export type LocalPTY = {
  id: string
  title: string
  rows?: number
  cols?: number
  buffer?: string
  scrollY?: number
}

export const { use: useTerminal, provider: TerminalProvider } = createSimpleContext({
  name: "Terminal",
  init: () => {
    const sdk = useSDK()
    const params = useParams()
    const legacy = createMemo(() => `${params.dir}/terminal${params.id ? "/" + params.id : ""}.v1`)

    const [store, setStore, _, ready] = persisted(
      Persist.scoped(params.dir!, params.id, "terminal", [legacy()]),
      createStore<{
        active?: string
        all: LocalPTY[]
      }>({
        all: [],
      }),
    )

    return {
      ready,
      all: createMemo(() => Object.values(store.all)),
      active: createMemo(() => store.active),
      new() {
        sdk.client.pty
          .create({ title: `Terminal ${store.all.length + 1}` })
          .then((pty) => {
            const id = pty.data?.id
            if (!id) return
            setStore("all", [
              ...store.all,
              {
                id,
                title: pty.data?.title ?? "Terminal",
              },
            ])
            setStore("active", id)
          })
          .catch((e) => {
            console.error("Failed to create terminal", e)
          })
      },
      update(pty: Partial<LocalPTY> & { id: string }) {
        setStore("all", (x) => x.map((x) => (x.id === pty.id ? { ...x, ...pty } : x)))
        sdk.client.pty
          .update({
            ptyID: pty.id,
            title: pty.title,
            size: pty.cols && pty.rows ? { rows: pty.rows, cols: pty.cols } : undefined,
          })
          .catch((e) => {
            console.error("Failed to update terminal", e)
          })
      },
      async clone(id: string) {
        const index = store.all.findIndex((x) => x.id === id)
        const pty = store.all[index]
        if (!pty) return
        const clone = await sdk.client.pty
          .create({
            title: pty.title,
          })
          .catch((e) => {
            console.error("Failed to clone terminal", e)
            return undefined
          })
        if (!clone?.data) return
        setStore("all", index, {
          ...pty,
          ...clone.data,
        })
        if (store.active === pty.id) {
          setStore("active", clone.data.id)
        }
      },
      open(id: string) {
        setStore("active", id)
      },
      async close(id: string) {
        batch(() => {
          setStore(
            "all",
            store.all.filter((x) => x.id !== id),
          )
          if (store.active === id) {
            const index = store.all.findIndex((f) => f.id === id)
            const previous = store.all[Math.max(0, index - 1)]
            setStore("active", previous?.id)
          }
        })
        await sdk.client.pty.remove({ ptyID: id }).catch((e) => {
          console.error("Failed to close terminal", e)
        })
      },
      move(id: string, to: number) {
        const index = store.all.findIndex((f) => f.id === id)
        if (index === -1) return
        setStore(
          "all",
          produce((all) => {
            all.splice(to, 0, all.splice(index, 1)[0])
          }),
        )
      },
    }
  },
})
