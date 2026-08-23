import { SessionMessageTable } from "@opencode-ai/core/session/sql"

type MessageData = (typeof SessionMessageTable.$inferInsert)["data"]

const user = {
  text: "Hello",
  time: { created: 0 },
} satisfies MessageData

const assistant = {
  agent: "build",
  model: { id: "model", providerID: "provider" },
  content: [],
  time: { created: 0 },
} satisfies MessageData

const invalid = {
  // @ts-expect-error Persisted message variants retain their field types.
  text: 42,
  time: { created: 0 },
} satisfies MessageData

void user
void assistant
void invalid
