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
OpenAI.configure({}).responses("gpt-4.1-mini")
OpenAI.configure({ apiKey: "sk-test" }).responses("gpt-4.1-mini")
OpenAI.configure({ apiKey: configApiKey }).responses("gpt-4.1-mini")
OpenAI.configure({ auth: RuntimeAuth.bearer("oauth-token") }).responses("gpt-4.1-mini")
OpenAI.configure({
  auth: RuntimeAuth.headers({ authorization: "Bearer gateway" }),
  baseURL: "https://gateway.example.com/v1",
}).responses("gpt-4.1-mini")
OpenAI.configure({
  generation: { maxTokens: 100 },
  providerOptions: { openai: { store: false } },
}).responses("gpt-4.1-mini")

// @ts-expect-error OpenAI model selectors only accept model ids.
OpenAI.configure({ apiKey: "sk-test" }).responses("gpt-4.1-mini", {})

// @ts-expect-error apiKey only accepts string, Redacted<string>, or Config<string | Redacted<string>>.
OpenAI.configure({ apiKey: 123 })

// @ts-expect-error provider helpers reject unknown top-level options.
OpenAI.configure({ bogus: true })

// @ts-expect-error common generation options remain typed.
OpenAI.configure({ generation: { maxTokens: "many" } })

// @ts-expect-error provider-native options remain typed.
OpenAI.configure({ providerOptions: { openai: { store: "false" } } })

// @ts-expect-error auth is an override, so OpenAI rejects apiKey with auth.
OpenAI.configure({ apiKey: "sk-test", auth: RuntimeAuth.bearer("oauth-token") })

OpenAI.chat("gpt-4.1-mini")
OpenAI.configure({ apiKey: "sk-test" }).chat("gpt-4.1-mini")
OpenAI.configure({ apiKey: configApiKey }).chat("gpt-4.1-mini")
OpenAI.configure({ auth: RuntimeAuth.bearer("oauth-token") }).chat("gpt-4.1-mini")

// @ts-expect-error OpenAI chat selectors only accept model ids.
OpenAI.configure({ apiKey: "sk-test" }).chat("gpt-4.1-mini", {})

// @ts-expect-error auth is an override, so OpenAI Chat rejects apiKey with auth.
OpenAI.configure({ apiKey: "sk-test", auth: RuntimeAuth.bearer("oauth-token") })

// @ts-expect-error Azure requires at least one of `resourceName` or `baseURL`.
Azure.configure()
Azure.configure({ apiKey: "azure-key", resourceName: "resource" }).responses("deployment")
Azure.configure({ apiKey: configApiKey, resourceName: "resource" }).responses("deployment")
Azure.configure({ auth: RuntimeAuth.header("api-key", "azure-key"), resourceName: "resource" }).responses("deployment")

// @ts-expect-error Azure model selectors only accept deployment ids.
Azure.configure({ apiKey: "azure-key", resourceName: "resource" }).responses("deployment", {})

// @ts-expect-error auth is an override, so Azure rejects apiKey with auth.
Azure.configure({ resourceName: "resource", apiKey: "azure-key", auth: RuntimeAuth.header("api-key", "override") })

Azure.configure({ apiKey: "azure-key", resourceName: "resource" }).chat("deployment")
Azure.configure({ apiKey: configApiKey, resourceName: "resource" }).chat("deployment")
Azure.configure({ auth: RuntimeAuth.header("api-key", "azure-key"), resourceName: "resource" }).chat("deployment")

// @ts-expect-error Azure chat model selectors only accept deployment ids.
Azure.configure({ apiKey: "azure-key", resourceName: "resource" }).chat("deployment", {})

// @ts-expect-error auth is an override, so Azure Chat rejects apiKey with auth.
Azure.configure({ resourceName: "resource", apiKey: "azure-key", auth: RuntimeAuth.header("api-key", "override") })
