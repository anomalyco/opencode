import {useSearchParams} from '@solidjs/router'
import { createSimpleContext } from "@opencode-ai/ui/context"
import { createMemo } from 'solid-js'

const toArray = (value: string | string[] | undefined) => {
  if (typeof value === "string") return [value]
  if (Array.isArray(value)) return value
  return []
}

const getFirst = (value: string | string[] | undefined) => {
  const array = toArray(value)
  return array[0]
}

const parseIdName = (value: string) => {
  const [id, name] = value.split("||")
  if (!id || !name) return undefined
  return { id, name }
}

export const { use: useParentParams, provider: ParentParamsProvider } = createSimpleContext({
  name: "ClientEnv",
  init: () => {
    const [searchParams] = useSearchParams()

    // Read the query params reactively (not a one-shot untrack snapshot): on a cold load the router
    // may not have parsed the URL yet when this provider initializes. A snapshot taken then would be
    // permanently empty, so every actor registration would go out without a userID/name and the
    // server would mint a "Guest-xxxx" identity. Memos re-read searchParams at access time, so by the
    // time register() runs the user param is present.
    const user = createMemo(() => toArray(searchParams.user).map(parseIdName).filter(Boolean))
    const team = createMemo(() => toArray(searchParams.team).map(parseIdName).filter(Boolean))

    return {
      get user() {
        return user()
      },
      get team() {
        return team()
      },
    }
  },
})