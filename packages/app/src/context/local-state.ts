export type ModelKey = { providerID: string; modelID: string }

export type State = {
  agent?: string
  model?: ModelKey
  variant?: string | null
  message?: string
}

const key = (item: { id?: string; name: string }) => item.id ?? item.name

const pickByKey = <T extends { id?: string; name: string }>(items: T[], value: string | undefined) => {
  if (!value) return undefined
  return items.find((item) => key(item) === value) ?? items.find((item) => item.name === value)
}

export const pickAgentItem = <T extends { id?: string; name: string }>(items: T[], value: string | undefined) => {
  if (items.length === 0) return undefined
  return pickByKey(items, value) ?? items[0]
}

export const syncSessionState = (
  prev: State | undefined,
  msg: { id: string; agent: string; model: ModelKey; variant?: string },
) => {
  if (prev?.message === msg.id) return
  return {
    agent: msg.agent,
    model: msg.model,
    variant: msg.variant ?? null,
    message: msg.id,
  } satisfies State
}

export const clone = (value: State | undefined) => {
  if (!value) return undefined
  return {
    ...value,
    model: value.model ? { ...value.model } : undefined,
  } satisfies State
}

export const getAgentKey = key
