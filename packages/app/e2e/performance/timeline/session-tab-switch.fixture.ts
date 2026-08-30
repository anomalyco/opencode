import type { SessionMessageInfo } from "@opencode-ai/client/promise"
import { fixture } from "./session-timeline-stress.fixture"

export const exchanges = 200

export const messages: Record<string, SessionMessageInfo[]> = Object.fromEntries(
  [fixture.sourceID, fixture.targetID].map((sessionID) => [
    sessionID,
    Array.from({ length: exchanges }, (_, index) => {
      const seed = fixture.messages[fixture.targetID]
      const user = seed[(index % (seed.length / 2)) * 2]!
      const assistant = seed[(index % (seed.length / 2)) * 2 + 1]!
      if (user.type !== "user" || assistant.type !== "assistant") throw new Error("Expected a user/assistant pair")
      const suffix = `${sessionID}_${String(index).padStart(4, "0")}`
      return [
        {
          ...user,
          id: `msg_user_${suffix}`,
          time: { created: 1700000000000 + index * 10_000 },
        },
        {
          ...assistant,
          id: `msg_assistant_${suffix}`,
          time: { created: 1700000001000 + index * 10_000, completed: 1700000008000 + index * 10_000 },
          content: [
            ...assistant.content
              .filter((part) => part.type !== "text")
              .map((part) => (part.type === "tool" ? { ...part, id: `${part.id}_${suffix}` } : part)),
            { type: "text", text: complexMarkdown(sessionID, index) },
          ],
        },
      ] satisfies SessionMessageInfo[]
    }).flat(),
  ]),
)

export const expected = Object.fromEntries(
  [fixture.sourceID, fixture.targetID].map((sessionID) => [
    sessionID,
    {
      lastID: messages[sessionID].at(-2)!.id,
      answerID: `${messages[sessionID].at(-1)!.id}:text:0`,
    },
  ]),
)

export const workload = {
  fixture: "long-complex-markdown-v1",
  exchangesPerSession: exchanges,
  messagesPerSession: exchanges * 2,
  history: "full fixture history in one response",
  sessions: Object.fromEntries(
    Object.entries(messages).map(([sessionID, items]) => [
      sessionID,
      {
        payloadBytes: Buffer.byteLength(JSON.stringify(items)),
        markdownBytes: items.reduce(
          (total, message) =>
            total +
            (message.type === "assistant"
              ? message.content.reduce(
                  (size, part) => size + (part.type === "text" ? Buffer.byteLength(part.text) : 0),
                  0,
                )
              : 0),
          0,
        ),
      },
    ]),
  ),
}

function complexMarkdown(sessionID: string, index: number) {
  return `## Renderer review ${sessionID} / ${index}

Preserve **semantic identity**, *measured geometry*, and ~~obsolete estimates~~ when switching sessions. The \`measureElement(node)\` result must agree with the [rendering contract](https://example.com/rendering/${sessionID}/${index}).

> A completed answer contains formatted prose, highlighted source, and structured results.
> Keep the previous view until the destination is ready, rather than exposing partially formatted content.

### Readiness checklist

- [x] Resolve the destination session and its messages.
- [x] Parse Markdown and highlight fenced code.
- [ ] Verify a different panel width.
  - Preserve the bottom anchor.
  - Reuse the measured rows when their width matches.

| Stage | Input | Expected result | Verification |
| :--- | ---: | :--- | :--- |
${Array.from({ length: 8 }, (_, row) => `| stage-${index}-${row} | ${index * 8 + row} | **ready** with \`row[${row}]\` | stable geometry and visible content |`).join("\n")}

### Implementation

\`\`\`tsx
import { For, Show, createMemo } from "solid-js"

type Row = { id: string; title: string; ready: boolean; height: number }

export function SessionRows${index}(props: { rows: Row[]; selected: string }) {
  const visible = createMemo(() => props.rows.filter((row) => row.ready))
  return (
    <section aria-label="${sessionID}-${index}">
      <For each={visible()}>{(row) => (
        <article data-selected={row.id === props.selected}>
          <h3>{row.title}</h3>
          <Show when={row.height > 0} fallback={<span>Measuring</span>}>
            <output>{row.height.toFixed(2)} pixels</output>
          </Show>
        </article>
      )}</For>
    </section>
  )
}
\`\`\`

\`\`\`json
${JSON.stringify({ session: sessionID, exchange: index, stages: ["hydrate", "parse", "highlight", "measure"], viewport: { width: 1440, height: 900 }, cache: { markdown: true, geometry: true } }, null, 2)}
\`\`\`

\`\`\`sql
SELECT session_id, COUNT(*) AS messages, MAX(created_at) AS latest
FROM session_message
WHERE session_id = '${sessionID}' AND ordinal >= ${index}
GROUP BY session_id
ORDER BY latest DESC;
\`\`\`

### Verification

1. Open the long source session and wait for its final answer.
2. Select the destination tab, without changing the viewport.
3. Confirm that **all Markdown is ready** and the bottom anchor is correct.

\`\`\`bash
bun typecheck
bunx playwright test --config e2e/performance/playwright.config.ts
git diff --check # ${sessionID}-${index}
\`\`\`

**Review complete: ${sessionID} / ${index}.**
`
}
