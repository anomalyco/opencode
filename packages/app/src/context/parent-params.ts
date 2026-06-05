import {useSearchParams} from '@solidjs/router'
import { createSimpleContext } from "@opencode-ai/ui/context"
import { untrack } from 'solid-js'

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

    const parentParams = untrack(() => {
      const user = toArray(searchParams.user).map(parseIdName).filter(Boolean)
      const team = toArray(searchParams.team).map(parseIdName).filter(Boolean)
      return { user, team }
    })

    return parentParams
  },
})