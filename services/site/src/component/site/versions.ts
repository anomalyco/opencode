/**
 * Named saved versions of one setting's value, with a built-in, read-only "Default". The setting
 * itself always holds the live value; a version is a snapshot of it. Switching copies a version into
 * the setting, saving copies the setting into a new version, updating overwrites the active one.
 * Generic so other settings can get versions too; the nav uses it first (nav-versions.tsx).
 */

export type Version<T> = { id: string; name: string; config: T }

export const defaultVersionID = "default"

export function createVersions<T>(options: {
  /** The saved versions, without Default. */
  versions: () => readonly Version<T>[]
  /** The active version's id ("default" for Default). */
  active: () => string
  /** The live value. */
  current: () => T
  /** Default's value. */
  base: () => T
  /** Built-in versions after Default, read-only like it (they can be saved as new versions). */
  presets?: () => readonly Version<T>[]
  /** Saves what changed as one undo step, named by `label`. */
  write: (change: { versions?: Version<T>[]; active?: string; current?: T }, label: string) => void
}) {
  const builtIn = (): Version<T>[] => [
    { id: defaultVersionID, name: "Default", config: options.base() },
    ...(options.presets?.() ?? []),
  ]
  const all = (): Version<T>[] => [...builtIn(), ...options.versions()]
  const active = () => all().find((version) => version.id === options.active()) ?? all()[0]
  const same = (a: T, b: T) => JSON.stringify(a) === JSON.stringify(b)
  // Through JSON, so store proxies copy too (and reading them tracks them).
  const clone = (value: T): T => JSON.parse(JSON.stringify(value))
  const nextName = () => {
    const names = all().map((version) => version.name)
    const number = Array.from({ length: names.length + 1 }, (_, index) => index + 2).find(
      (count) => !names.includes(`Version ${count}`),
    )
    return `Version ${number}`
  }

  const switchTo = (id: string) => {
    const version = all().find((item) => item.id === id)
    if (!version || version.id === active().id) return
    options.write({ active: version.id, current: clone(version.config) }, `Version: ${version.name}`)
  }

  return {
    all,
    active,
    /** Default and the presets: no rename, update or delete. */
    readOnly: (id: string) => builtIn().some((version) => version.id === id),
    /** The live value differs from the active version's. */
    edited: () => !same(options.current(), active().config),
    switchTo,
    /** Steps through the versions in their listed order, wrapping at the ends. */
    cycle(direction: 1 | -1) {
      const list = all()
      const index = list.findIndex((version) => version.id === active().id)
      const next = list[(index + direction + list.length) % list.length]
      if (next) switchTo(next.id)
    },
    /** Saves the live value as a new version and makes it active; returns its id. */
    save(name = nextName()) {
      const id = `v${Date.now().toString(36)}`
      options.write(
        { versions: [...options.versions(), { id, name, config: clone(options.current()) }], active: id },
        `Saved ${name}`,
      )
      return id
    },
    update() {
      const version = active()
      if (builtIn().some((item) => item.id === version.id)) return
      options.write(
        {
          versions: options
            .versions()
            .map((item) => (item.id === version.id ? { ...item, config: clone(options.current()) } : item)),
        },
        `Updated ${version.name}`,
      )
    },
    rename(id: string, name: string) {
      const text = name.trim()
      const version = options.versions().find((item) => item.id === id)
      if (!version || !text || text === version.name) return
      options.write(
        { versions: options.versions().map((item) => (item.id === id ? { ...item, name: text } : item)) },
        `Renamed ${text}`,
      )
    },
    /** Deletes a version; the active one hands over to Default, keeping the live value. */
    remove(id: string) {
      const version = options.versions().find((item) => item.id === id)
      if (!version) return
      options.write(
        {
          versions: options.versions().filter((item) => item.id !== id),
          ...(options.active() === id ? { active: defaultVersionID } : {}),
        },
        `Deleted ${version.name}`,
      )
    },
  }
}
