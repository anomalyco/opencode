import { Config } from "effect"
import type { Auth } from "../src/route/auth"
import type { ModelFactory } from "../src/route/auth-options"
import { Auth as RuntimeAuth } from "../src/route/auth"
import * as Azure from "../src/providers/azure"
import * as OpenAI from "../src/providers/openai"

type BaseOptions = {
  readonly baseURL?: string
  readonly headers?: Record<string, string>
}

type Model = {
  readonly id: string
}

declare const auth: Auth
declare const optionalAuthModel: ModelFactory<BaseOptions, "optional", Model>
declare const requiredAuthModel: ModelFactory<BaseOptions, "required", Model>
const configApiKey = Config.redacted("OPENAI_API_KEY")

optionalAuthModel("gpt-4.1-mini")
optionalAuthModel("gpt-4.1-mini", {})
optionalAuthModel("gpt-4.1-mini", { apiKey: "sk-test" })
optionalAuthModel("gpt-4.1-mini", { apiKey: configApiKey })
optionalAuthModel("gpt-4.1-mini", { auth })
optionalAuthModel("gpt-4.1-mini", { auth, baseURL: "https://gateway.example.com/v1" })
optionalAuthModel("gpt-4.1-mini", { apiKey: "sk-test", headers: { "x-source": "test" } })

// @ts-expect-error auth is an override, so apiKey cannot be supplied with it.
optionalAuthModel("gpt-4.1-mini", { apiKey: "sk-test", auth })

requiredAuthModel("custom-model", { apiKey: "key" })
requiredAuthModel("custom-model", { apiKey: configApiKey })
requiredAuthModel("custom-model", { auth })
requiredAuthModel("custom-model", { auth, headers: { "x-tenant-id": "tenant" } })

// @ts-expect-error providers without config fallback need apiKey or auth.
requiredAuthModel("custom-model")

// @ts-expect-error providers without config fallback need apiKey or auth.
requiredAuthModel("custom-model", {})

// @ts-expect-error auth is an override, so apiKey cannot be supplied with it.
requiredAuthModel("custom-model", { apiKey: "key", auth })

OpenAI.responses("gpt-4.1-mini")
OpenAI.responses("gpt-4.1-mini", {})
OpenAI.responses("gpt-4.1-mini", { apiKey: "sk-test" })
OpenAI.responses("gpt-4.1-mini", { apiKey: configApiKey })
OpenAI.responses("gpt-4.1-mini", { auth: RuntimeAuth.bearer("oauth-token") })
OpenAI.responses("gpt-4.1-mini", {
  auth: RuntimeAuth.headers({ authorization: "Bearer gateway" }),
  baseURL: "https://gateway.example.com/v1",
})
OpenAI.responses("gpt-4.1-mini", {
  generation: { maxTokens: 100 },
  providerOptions: { openai: { store: false } },
})

// @ts-expect-error apiKey only accepts string, Redacted<string>, or Config<string | Redacted<string>>.
OpenAI.responses("gpt-4.1-mini", { apiKey: 123 })

// @ts-expect-error provider helpers reject unknown top-level options.
OpenAI.responses("gpt-4.1-mini", { bogus: true })

// @ts-expect-error common generation options remain typed.
OpenAI.responses("gpt-4.1-mini", { generation: { maxTokens: "many" } })

// @ts-expect-error provider-native options remain typed.
OpenAI.responses("gpt-4.1-mini", { providerOptions: { openai: { store: "false" } } })

// @ts-expect-error auth is an override, so OpenAI rejects apiKey with auth.
OpenAI.responses("gpt-4.1-mini", { apiKey: "sk-test", auth: RuntimeAuth.bearer("oauth-token") })

OpenAI.chat("gpt-4.1-mini")
OpenAI.chat("gpt-4.1-mini", { apiKey: "sk-test" })
OpenAI.chat("gpt-4.1-mini", { apiKey: configApiKey })
OpenAI.chat("gpt-4.1-mini", { auth: RuntimeAuth.bearer("oauth-token") })

// @ts-expect-error auth is an override, so OpenAI Chat rejects apiKey with auth.
OpenAI.chat("gpt-4.1-mini", { apiKey: "sk-test", auth: RuntimeAuth.bearer("oauth-token") })

// @ts-expect-error Azure requires at least one of `resourceName` or `baseURL`.
Azure.responses("deployment")
Azure.responses("deployment", { apiKey: "azure-key", resourceName: "resource" })
Azure.responses("deployment", { apiKey: configApiKey, resourceName: "resource" })
Azure.responses("deployment", { auth: RuntimeAuth.header("api-key", "azure-key"), resourceName: "resource" })

// @ts-expect-error auth is an override, so Azure rejects apiKey with auth.
Azure.responses("deployment", { apiKey: "azure-key", auth: RuntimeAuth.header("api-key", "override") })

// @ts-expect-error Azure requires at least one of `resourceName` or `baseURL`.
Azure.chat("deployment")
Azure.chat("deployment", { apiKey: "azure-key", resourceName: "resource" })
Azure.chat("deployment", { apiKey: configApiKey, resourceName: "resource" })
Azure.chat("deployment", { auth: RuntimeAuth.header("api-key", "azure-key"), resourceName: "resource" })

// @ts-expect-error auth is an override, so Azure Chat rejects apiKey with auth.
Azure.chat("deployment", { apiKey: "azure-key", auth: RuntimeAuth.header("api-key", "override") })
