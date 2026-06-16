export type DocActor = {
  actorID: string
  name: string
}

export function label(actorID: string, name?: string) {
  return name?.trim() || actorID
}

export function actor(value: unknown): DocActor | undefined {
  if (!value || typeof value !== "object") return
  const user = (value as { user?: unknown }).user
  if (!user || typeof user !== "object") return
  const actorID = (user as { actorID?: unknown }).actorID
  if (typeof actorID !== "string") return
  const name = (user as { name?: unknown }).name
  if (name !== undefined && typeof name !== "string") return
  return { actorID, name: label(actorID, name) }
}
