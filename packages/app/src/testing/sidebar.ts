import type { E2EWindow } from "./terminal"

const key = "opencode.e2e.dat:sidebar"

const enabled = () => {
  if (typeof window === "undefined") return false
  return (window as E2EWindow).__opencode_e2e?.sidebar?.enabled === true
}

const read = () => {
  if (!enabled()) return []
  if (typeof localStorage === "undefined") return []
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return []
    const value = JSON.parse(raw) as unknown
    if (!Array.isArray(value)) return []
    return value.filter((x): x is string => typeof x === "string")
  } catch {
    return []
  }
}

const write = (list: string[]) => {
  if (!enabled()) return
  if (typeof localStorage === "undefined") return
  try {
    localStorage.setItem(key, JSON.stringify(list))
  } catch {
    return
  }
}

export const sidebarE2E = {
  list() {
    return read()
  },
  open(directory: string) {
    const list = read()
    if (list.includes(directory)) return
    write([...list, directory])
  },
  close(directory: string) {
    write(read().filter((x) => x !== directory))
  },
}
