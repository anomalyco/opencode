import { Filesystem } from "./filesystem"

export namespace JsonStore {
  export function create<T>(options: {
    path: () => string
    mode?: number
    validate?: (raw: unknown) => T | undefined
  }) {
    const { path: getPath, mode = 0o600, validate } = options

    return {
      async all(): Promise<Record<string, T>> {
        const data = await Filesystem.readJson<Record<string, unknown>>(getPath()).catch(() => ({}))
        if (!validate) return data as Record<string, T>
        return Object.entries(data).reduce(
          (acc, [key, value]) => {
            const parsed = validate(value)
            if (parsed === undefined) return acc
            acc[key] = parsed
            return acc
          },
          {} as Record<string, T>,
        )
      },

      async get(key: string): Promise<T | undefined> {
        const map = await this.all()
        return map[key]
      },

      async set(key: string, value: T): Promise<void> {
        const data = await this.all()
        await Filesystem.writeJson(getPath(), { ...data, [key]: value }, mode)
      },

      async remove(key: string): Promise<void> {
        const data = await this.all()
        delete data[key]
        await Filesystem.writeJson(getPath(), data, mode)
      },
    }
  }
}
