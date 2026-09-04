import { createSignal, Show } from "solid-js"
import { render } from "solid-js/web"
import { Markdown } from "../../src/components/markdown"
import { getCachedMarkdown } from "../../src/components/markdown-cache"
import type { MarkdownWorkerRequest, MarkdownWorkerResponse } from "../../src/components/markdown-worker-protocol"
import "@opencode-ai/ui/styles"
import "@opencode-ai/ui/styles/tokens"
import "../../src/components/markdown.css"

const scenario = new URLSearchParams(location.search).get("scenario") ?? "mounted"
const sections = Array.from({ length: 36 }, (_, index) => {
  const service = ["catalog", "billing", "delivery", "inventory", "accounts", "notifications"][index % 6]
  return [
    `## ${index + 1}. Validate the ${service} recovery boundary`,
    `The ${service} service should publish durable progress before acknowledging a request. Keep the request ID in the transaction so a retry does not create a second operation. The implementation below separates admission from delivery and makes the recovery decision explicit.`,
    "Check the existing rows before scheduling work. A disconnected client is not evidence that the operation failed, and the background processor must not delete accepted work when a view closes. Use the stored status for the next attempt, not a process-local flag.",
    `\`\`\`typescript\nexport async function recover${index}(db: Database, request: Request) {\n  const previous = await db.operations.find(request.id)\n  if (previous?.status === "complete") return previous.result\n  const operation = previous ?? await db.transaction(async (tx) => {\n    const row = await tx.operations.insert({\n      id: request.id,\n      service: "${service}",\n      status: "accepted",\n      payload: request.payload,\n    })\n    await tx.events.publish({ type: "operation.accepted", id: row.id })\n    return row\n  })\n  await schedule(operation.id)\n  return { id: operation.id, status: operation.status }\n}\n\`\`\``,
    "| Condition | Expected behavior |\n| --- | --- |\n| Duplicate request | Return the first accepted result |\n| Worker restart | Resume the stored operation |\n| Client leaves | Retain accepted work without retaining the view |",
    `Run the focused test with \`bun test test/${service}/recovery.test.ts\`. Verify the [transaction contract](https://example.com/transactions) and inspect the operation's final state before expanding the rollout.`,
  ].join("\n\n")
})
const answer = `# Recovery implementation review\n\n${sections.join("\n\n")}\n\n**Review complete.**`
const destination =
  "## Current destination\n\nThe new session is ready.\n\n```typescript\nconst current = { ready: true }\n```"
const stats = {
  bytes: new TextEncoder().encode(answer).length,
  fences: sections.length,
  messages: 1,
  parts: 1,
  requests: 0,
  responses: 0,
  released: 0,
  ready: 0,
  settled: 0,
  disposed: false,
  cacheChars: 0,
}

// Keep the real worker and parser. Only hold delivery of this answer's result so
// disposal always happens after admission and before main-thread postprocessing.
const descriptor = Object.getOwnPropertyDescriptor(Worker.prototype, "onmessage")!
const post = Worker.prototype.postMessage
let held: (() => void) | undefined
let answerID: number | undefined
Object.defineProperty(Worker.prototype, "onmessage", {
  configurable: true,
  get: descriptor.get,
  set(callback: (event: MessageEvent<MarkdownWorkerResponse>) => void) {
    descriptor.set!.call(this, (event: MessageEvent<MarkdownWorkerResponse>) => {
      if (event.data.type === "parse" && event.data.id === answerID) {
        stats.responses++
        held = () => callback.call(this, event)
        document.querySelector<HTMLButtonElement>("#continue")!.disabled = false
        return
      }
      callback.call(this, event)
    })
  },
})
Worker.prototype.postMessage = function (request: MarkdownWorkerRequest) {
  if (request.type === "parse" && request.text === answer) {
    answerID = request.id
    stats.requests++
  }
  post.call(this, request)
}

const observer = new MutationObserver(() => {
  if (!stats.released || stats.ready) return
  const target = document.querySelector(scenario === "leave" ? "#destination" : "#survivor")
  if (!target?.hasAttribute("data-markdown-ready")) return
  stats.ready = performance.now()
  document.body.dataset.ready = "true"
})
observer.observe(document.body, { subtree: true, attributes: true, childList: true })

render(() => {
  const [admitted, setAdmitted] = createSignal(false)
  const [leaving, setLeaving] = createSignal(false)
  return (
    <main style={{ "max-width": "960px", margin: "24px auto", "font-family": "sans-serif", "line-height": "1.5" }}>
      <button id="admit" onClick={() => setAdmitted(true)} disabled={admitted()}>
        Admit answer
      </button>
      <button
        id="continue"
        disabled
        onClick={() => {
          stats.released = performance.now()
          performance.mark("markdown-lifetime-release")
          if (scenario !== "mounted") {
            stats.disposed = true
            setLeaving(true)
          }
          held!()
          held = undefined
          const channel = new MessageChannel()
          channel.port1.onmessage = () => {
            stats.settled = performance.now()
            stats.cacheChars = getCachedMarkdown("lifetime:0:full")?.html.length ?? 0
            document.body.dataset.settled = "true"
            channel.port1.close()
            channel.port2.close()
          }
          channel.port2.postMessage(null)
        }}
      >
        Continue
      </button>
      <Show when={admitted()}>
        <Show when={!leaving()}>
          <Markdown
            id={scenario === "shared" ? "departing" : "survivor"}
            text={answer}
            cacheKey="lifetime"
            deferUntilReady
          />
        </Show>
        <Show when={scenario === "shared"}>
          <Markdown id="survivor" text={answer} cacheKey="lifetime" deferUntilReady />
        </Show>
        <Show when={leaving() && scenario === "leave"}>
          <Markdown id="destination" text={destination} cacheKey="destination" deferUntilReady />
        </Show>
      </Show>
    </main>
  )
}, document.getElementById("root")!)

Object.defineProperty(window, "markdownLifetime", { value: stats })
