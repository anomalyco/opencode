import { createSimpleContext } from "@opencode-ai/ui/context"

type IdName = { id: string; name: string; color?: string }
type ParentParams = { user: IdName[]; team: IdName[] }

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/

// Identity can arrive as `id||name` or `id||name||color`. The optional 3rd segment is a hex color
// (e.g. `#FF8800`) the host wants this user to wear as their collaborative color (cursor label +
// avatar). Note: in a query string `#` is the fragment delimiter, so the host must percent-encode it
// (`%23FF8800`); `URLSearchParams.getAll` decodes it back before we see it here. Invalid colors are
// dropped so the server falls back to its own assigned color.
const parseIdName = (value: string): IdName | undefined => {
  const [id, name, color] = value.split("||")
  if (!id || !name) return undefined
  return color && HEX_COLOR.test(color) ? { id, name, color } : { id, name }
}

const filterIdName = (values: string[]): IdName[] =>
  values.map(parseIdName).filter((item): item is IdName => !!item)

const STORAGE_KEY = "parent-params:v1"

const parseSearch = (search: string): ParentParams => {
  const params = new URLSearchParams(search)
  return {
    user: filterIdName(params.getAll("user")),
    team: filterIdName(params.getAll("team")),
  }
}

// The host passes the viewer identity via `?user=id||name` (and optionally `?team=`) on the ENTRY url
// only. The app then redirects (`/` → `/session/...`) and that navigation drops the query string, so
// by the time the prompt-doc actor registers the param is already gone — registration falls back to a
// tab-scoped "Guest-xxxx" actor. This bites hardest in an iframe embed, where the redirect wins the
// race against any in-render read.
//
// So capture once at MODULE LOAD — earlier than any router render or redirect, while
// `window.location` still holds the entry url — and persist to sessionStorage so the identity also
// survives a later full reload of the param-less `/session/...` url. Reading `searchParams`
// reactively/at-init is NOT enough: the value legitimately disappears after the redirect.
const capture = (): ParentParams => {
  if (typeof window === "undefined") return { user: [], team: [] }
  const fromUrl = parseSearch(window.location.search)
  if (fromUrl.user.length || fromUrl.team.length) {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(fromUrl))
    } catch {
      // ignore storage access errors (e.g. partitioned third-party iframe)
    }
    return fromUrl
  }
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw) as ParentParams
  } catch {
    // ignore
  }
  return { user: [], team: [] }
}

const captured = capture()

export const { use: useParentParams, provider: ParentParamsProvider } = createSimpleContext({
  name: "ClientEnv",
  init: (): ParentParams => captured,
})
