import type { FormAnswer, IntegrationPrompt } from "@opencode/client/promise"
import { render } from "solid-js/web"
import { createStore } from "solid-js/store"
import { LanguageProvider } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"
import { createProviderConnectionController } from "../src/providers/connect/controller"

export type Scenario = "expired" | "missing" | "next" | "complete" | "hidden"

export function mountConnection(scenario: Scenario) {
  const host = document.createElement("div")
  host.dataset.testid = "provider-connection"
  document.body.appendChild(host)
  const [record, setRecord] = createStore<{ requests: { answer?: FormAnswer }[]; submissions: FormAnswer[] }>({
    requests: [],
    submissions: [],
  })
  let submitted = false
  const prompt = (id: string): IntegrationPrompt => ({
    id,
    title: id,
    fields: [
      { type: "string", key: "server", hidden: true, required: true, default: "https://example.com" },
      { type: "string", key: "scope", hidden: true, default: "gateway" },
      { type: "string", key: "name", required: true },
    ],
  })
  Object.assign(useServerSDK().api, {
    integration: {
      get: async () => ({
        data: {
          id: "vercel",
          name: "Vercel",
          connections: [],
          methods: [
            {
              type: "oauth",
              id: "setup",
              label: "Sign in",
              form: [{ type: "string", key: "credentialID", hidden: true, default: "cred_existing" }],
            },
          ],
        },
      }),
      oauth: {
        connect: async (input: { answer?: FormAnswer }) => {
          setRecord("requests", (requests) => [...requests, input])
          submitted = false
          return {
            data: {
              mode: "auto",
              attemptID: `attempt_${record.requests.length}`,
              url: "https://example.com",
              instructions: "Sign in",
              time: { created: 1, expires: 9999999999999 },
            },
          }
        },
        cancel: async () => {},
        status: async () => {
          if (!submitted) return { data: { status: "pending", prompt: prompt("step_1") } }
          if (scenario === "missing") throw { _tag: "IntegrationAttemptNotFoundError" }
          if (scenario === "expired") return { data: { status: "expired" } }
          if (scenario === "next") return { data: { status: "pending", prompt: prompt("step_2") } }
          return { data: { status: "complete", next: { title: "Manage budget", url: "https://example.com/budget" } } }
        },
        complete: async (input: { answer: FormAnswer }) => {
          setRecord("submissions", (submissions) => [...submissions, input.answer])
          submitted = true
          if (scenario !== "hidden") throw new Error("Response lost")
        },
      },
    },
  })

  function Connection() {
    const controller = createProviderConnectionController({
      provider: () => "vercel",
      directory: () => undefined,
      manual: () => true,
      onComplete: () => {},
    })
    return (
      <>
        <button disabled={controller.loading()} onClick={() => void controller.auth.select(0)}>
          Start
        </button>
        <button onClick={() => void controller.auth.completePrompt({ name: "OpenCode" })}>Submit</button>
        <button onClick={() => void controller.auth.retry()}>Retry</button>
        <output data-testid="state">{controller.auth.state()}</output>
        <output data-testid="step">{controller.prompt()?.id}</output>
        <output data-testid="receipt">{controller.receipt()?.title}</output>
        <output data-testid="attempts">{controller.authorization()?.attemptID}</output>
        <output data-testid="answers">{JSON.stringify(record.requests.map((request) => request.answer))}</output>
        <output data-testid="submissions">{JSON.stringify(record.submissions)}</output>
      </>
    )
  }

  render(
    () => (
      <LanguageProvider locale="en">
        <Connection />
      </LanguageProvider>
    ),
    host,
  )
}
