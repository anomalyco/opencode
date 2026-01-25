import { Instance } from "../project/instance"

export namespace Env {
  const state = Instance.state(() => {
    return process.env as Record<string, string | undefined>
  })

  export function get(key: string) {
    const env = state()
    return env[key]
  }

  export function all() {
    return state()
  }

  export function set(key: string, value: string) {
    const env = state()
    env[key] = value
  }

  export function remove(key: string) {
    const env = state()
    delete env[key]
  }
}
