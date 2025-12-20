import { Context } from "../context"

export namespace Log {
  const ctx = Context.create<{
    tags: Record<string, any>
  }>()

  export function create(tags?: Record<string, any>) {
    tags = tags || {}

    const result = {
      info(message?: any, extra?: Record<string, any>) {
        const prefix = Object.entries({
          ...use().tags,
          ...tags,
          ...extra,
        })
          .map(([key, value]) => `${key}=${value}`)
          .join(" ")
        console.log(prefix, message)
        return result
      },
      tag(key: string, value: string) {
        if (tags) tags[key] = value
        return result
      },
      clone() {
        return Log.create({ ...tags })
      },
    }

    return result
  }

  export function provide<R>(tags: Record<string, any>, cb: () => R) {
    const existing = use()
    return ctx.provide(
      {
        tags: {
          ...existing.tags,
          ...tags,
        },
      },
      cb,
    )
  }

  function use() {
    try {
      return ctx.use()
    } catch (e) {
      return { tags: {} }
    }
  }
}
