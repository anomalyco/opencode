import { createClient } from "@openauthjs/openauth/client"
import { makePersisted } from "@solid-primitives/storage"
import { createAsync } from "@solidjs/router"
import {
  batch,
  createContext,
  createEffect,
  createResource,
  createSignal,
  onMount,
  ParentProps,
  Show,
  Suspense,
  useContext,
} from "solid-js"
import { createStore, produce } from "solid-js/store"
import { isServer } from "solid-js/web"

interface Storage {
  subjects: Record<string, SubjectInfo>
  current?: string
}

interface Context {
  all: Record<string, SubjectInfo>
  subject?: SubjectInfo
  switch(id: string): void
  logout(id: string): void
  access(id?: string): Promise<string | undefined>
  authorize(opts?: AuthorizeOptions): void
}

export interface AuthorizeOptions {
  redirectPath?: string
  provider?: string
}

interface SubjectInfo {
  id: string
  refresh: string
}

interface AuthContextOpts {
  issuer: string
  clientID: string
}

const context = createContext<Context>()

export function OpenAuthProvider(props: ParentProps<AuthContextOpts>) {
  const client = createClient({
    issuer: props.issuer,
    clientID: props.clientID,
  })
  const [storage, setStorage] = makePersisted(
    createStore<Storage>({
      subjects: {},
    }),
    {
      name: `${props.issuer}.auth`,
    },
  )

  const resource = createAsync(async () => {
    if (isServer) return true
    const hash = new URLSearchParams(window.location.search.substring(1))
    const code = hash.get("code")
    const state = hash.get("state")
    if (code && state) {
      const oldState = sessionStorage.getItem("openauth.state")
      const verifier = sessionStorage.getItem("openauth.verifier")
      const redirect = sessionStorage.getItem("openauth.redirect")
      if (redirect && verifier && oldState === state) {
        const result = await client.exchange(code, redirect, verifier)
        if (!result.err) {
          const id = result.tokens.refresh.split(":").slice(0, -1).join(":")
          batch(() => {
            setStorage("subjects", id, {
              id: id,
              refresh: result.tokens.refresh,
            })
            setStorage("current", id)
          })
        }
      }
    }
    return true
  })

  async function authorize(opts?: AuthorizeOptions) {
    const redirect = new URL(window.location.origin + (opts?.redirectPath ?? "/")).toString()
    const authorize = await client.authorize(redirect, "code", {
      pkce: true,
      provider: opts?.provider,
    })
    sessionStorage.setItem("openauth.state", authorize.challenge.state)
    sessionStorage.setItem("openauth.redirect", redirect)
    if (authorize.challenge.verifier) sessionStorage.setItem("openauth.verifier", authorize.challenge.verifier)
    window.location.href = authorize.url
  }

  const accessCache = new Map<string, string>()
  const pendingRequests = new Map<string, Promise<any>>()
  async function access(id: string) {
    const pending = pendingRequests.get(id)
    if (pending) return pending
    const promise = (async () => {
      const existing = accessCache.get(id)
      const subject = storage.subjects[id]
      const access = await client.refresh(subject.refresh, {
        access: existing,
      })
      if (access.err) {
        pendingRequests.delete(id)
        ctx.logout(id)
        return
      }
      if (access.tokens) {
        setStorage("subjects", id, "refresh", access.tokens.refresh)
        accessCache.set(id, access.tokens.access)
      }
      pendingRequests.delete(id)
      return access.tokens?.access || existing!
    })()
    pendingRequests.set(id, promise)
    return promise
  }

  const ctx: Context = {
    get all() {
      return storage.subjects
    },
    get subject() {
      if (!storage.current) return
      return storage.subjects[storage.current!]
    },
    switch(id: string) {
      if (!storage.subjects[id]) return
      setStorage("current", id)
    },
    authorize,
    logout(id: string) {
      if (!storage.subjects[id]) return
      setStorage(
        produce((s) => {
          delete s.subjects[id]
          if (s.current === id) s.current = Object.keys(s.subjects)[0]
        }),
      )
    },
    async access(id?: string) {
      id = id || storage.current
      if (!id) return
      return access(id || storage.current!)
    },
  }

  createEffect(() => {
    if (!resource()) return
    if (storage.current) return
    const [first] = Object.keys(storage.subjects)
    if (first) {
      setStorage("current", first)
      return
    }
  })

  return (
    <>
      {resource()}
      <context.Provider value={ctx}>{props.children}</context.Provider>
    </>
  )
}

export function useOpenAuth() {
  const result = useContext(context)
  if (!result) throw new Error("no auth context")
  return result
}
