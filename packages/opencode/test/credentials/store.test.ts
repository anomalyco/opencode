import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Global } from "../../src/global"
import { CredentialStore } from "../../src/credentials/store"

async function resetCredentialDir() {
  await fs.rm(path.join(Global.Path.data, "credentials"), { recursive: true, force: true })
}

describe("CredentialStore", () => {
  test("stores secrets encrypted at rest", async () => {
    await resetCredentialDir()
    const accessToken = "token-plaintext"
    const refreshToken = "refresh-plaintext"

    const record = await CredentialStore.put({
      providerId: "openai",
      namespace: "default",
      kind: "oauth",
      label: "default",
      secret: { accessToken, refreshToken },
    })

    const onDisk = await Bun.file(path.join(Global.Path.data, "credentials", "records", `${record.meta.id}.json`)).text()
    expect(onDisk).not.toContain(accessToken)
    expect(onDisk).not.toContain(refreshToken)

    const decrypted = await CredentialStore.decryptSecret(record)
    expect(decrypted).toEqual({ accessToken, refreshToken })
  })

  test("upsertSingleton updates existing record", async () => {
    await resetCredentialDir()

    const first = await CredentialStore.upsertSingleton({
      providerId: "anthropic",
      namespace: "default",
      kind: "api",
      label: "default",
      secret: { apiKey: "key-1" },
    })
    const second = await CredentialStore.upsertSingleton({
      providerId: "anthropic",
      namespace: "default",
      kind: "api",
      label: "default",
      secret: { apiKey: "key-2" },
    })

    expect(second.meta.id).toEqual(first.meta.id)
    const decrypted = await CredentialStore.decryptSecret(second)
    expect(decrypted).toEqual({ apiKey: "key-2" })
  })

  test("maintains on-disk index for provider lookups", async () => {
    await resetCredentialDir()

    const id = "cred-idx-1"
    await CredentialStore.put({
      id,
      providerId: "openai",
      namespace: "default",
      kind: "oauth",
      label: "default",
      secret: { accessToken: "t", refreshToken: "r" },
    })

    const indexPath = path.join(Global.Path.data, "credentials", "index.json")
    const raw = await Bun.file(indexPath).json()
    expect(raw).toMatchObject({
      version: 1,
      byProvider: {
        openai: {
          default: [id],
        },
      },
    })

    await CredentialStore.remove(id)
    const after = await Bun.file(indexPath).json()
    expect(after).toMatchObject({
      version: 1,
      byProvider: {
        openai: {
          default: [],
        },
      },
    })
  })
})
