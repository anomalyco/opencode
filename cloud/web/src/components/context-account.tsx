import { createContext, createEffect, ParentProps, Suspense, useContext } from "solid-js"
import { makePersisted } from "@solid-primitives/storage"
import { createStore } from "solid-js/store"
import { useOpenAuth } from "./context-openauth"
import { createAsync } from "@solidjs/router"
import { isServer } from "solid-js/web"

type Storage = {
  accounts: Record<
    string,
    {
      id: string
      email: string
      workspaces: {
        id: string
        name: string
        slug: string
      }[]
    }
  >
}

const context = createContext<ReturnType<typeof init>>()

function init() {
  const auth = useOpenAuth()
  const [store, setStore] = makePersisted(
    createStore<Storage>({
      accounts: {},
    }),
    {
      name: "opencontrol.account",
    },
  )

  async function refresh(id: string) {
    return fetch(import.meta.env.VITE_API_URL + "/rest/account", {
      headers: {
        authorization: `Bearer ${await auth.access(id)}`,
      },
    })
      .then((val) => val.json())
      .then((val) => setStore("accounts", id, val as any))
  }

  createEffect((previous: string[]) => {
    if (Object.keys(auth.all).length === 0) {
      return []
    }
    for (const item of Object.values(auth.all)) {
      if (previous.includes(item.id)) continue
      refresh(item.id)
    }
    return Object.keys(auth.all)
  }, [] as string[])

  const result = {
    get all() {
      return Object.keys(auth.all)
        .map((id) => store.accounts[id])
        .filter(Boolean)
    },
    get current() {
      if (!auth.subject) return undefined
      return store.accounts[auth.subject.id]
    },
    refresh,
    get ready() {
      return Object.keys(auth.all).length === result.all.length
    },
  }

  return result
}

export function AccountProvider(props: ParentProps) {
  const ctx = init()
  const resource = createAsync(async () => {
    await new Promise<void>((resolve) => {
      if (isServer) return resolve()
      createEffect(() => {
        if (ctx.ready) resolve()
      })
    })
    return null
  })
  return (
    <Suspense>
      {resource()}
      <context.Provider value={ctx}>{props.children}</context.Provider>
    </Suspense>
  )
}

export function useAccount() {
  const result = useContext(context)
  if (!result) throw new Error("no account context")
  return result
}
