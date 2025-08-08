import { Entry } from "@napi-rs/keyring"
import * as keytar from "@napi-rs/keyring/keytar"

export namespace Keychain {
  const service = "opencode.auth"

  export async function set(account: string, password: string) {
    const entry = new Entry(service, account)
    entry.setPassword(password)
  }

  export async function get(account: string): Promise<string | null> {
    const entry = new Entry(service, account)
    try {
      const pwd = entry.getPassword() as unknown as string | null | undefined
      return pwd ?? null
    } catch {
      return null
    }
  }

  export async function remove(account: string): Promise<boolean> {
    const entry = new Entry(service, account)
    try {
      return entry.deletePassword() as unknown as boolean
    } catch {
      return false
    }
  }

  export async function list(): Promise<Array<{ account: string; password: string }>> {
    try {
      return await keytar.findCredentials(service)
    } catch {
      return []
    }
  }
}
