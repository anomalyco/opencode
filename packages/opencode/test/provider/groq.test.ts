import { describe, test, expect } from "bun:test"
import { Provider } from "../../src/provider/provider"
import { App } from "../../src/app/app"

process.env.GROQ_API_KEY = "test"

describe("provider.groq", () => {
  test("loads from env", async () => {
    const providers = await App.provide({ cwd: process.cwd() }, async () => {
      return await Provider.list()
    })
    expect(providers["groq"]).toBeTruthy()
    expect(providers["groq"].info.models["moonshotai/kimi-k2-instruct"]).toBeTruthy()
  })
})
