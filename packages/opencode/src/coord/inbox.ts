import { Lock } from "@/util/lock"
import { Storage } from "@/storage/storage"
import * as Paths from "./paths"
import { createMessage, type Message, type MessageInput, safeValidate } from "./protocol"

export type IndexedMessage = Message & { index: number }

async function readInbox(file: string) {
  const inbox = await Bun.file(file).json().catch(() => [] as Message[])
  if (!Array.isArray(inbox)) return []
  return inbox
}

async function writeInbox(file: string, messages: Message[]) {
  await Bun.write(file, JSON.stringify(messages, null, 2))
}

export async function sendMessage(input: { teamID: string; recipient: string; message: MessageInput }) {
  const file = Paths.inboxFile(input.teamID, input.recipient)
  await Paths.ensureTeam(input.teamID)
  using _ = await Lock.write(file)
  const messages = await readInbox(file)
  messages.push(createMessage(input.message))
  await writeInbox(file, messages)
  await Storage.write(["coord", "inbox", input.teamID, input.recipient], messages)
}

export async function inbox(input: { teamID: string; member: string }) {
  const file = Paths.inboxFile(input.teamID, input.member)
  using _ = await Lock.read(file)
  const messages = await readInbox(file)
  return messages.map((message, index) => ({ ...message, index }))
}

export async function unread(input: { teamID: string; member: string }) {
  const messages = await inbox(input)
  return messages.filter((message) => !message.read)
}

export async function markRead(input: { teamID: string; member: string; index?: number }) {
  const file = Paths.inboxFile(input.teamID, input.member)
  using _ = await Lock.write(file)
  const messages = await readInbox(file)
  if (input.index === undefined) {
    messages.forEach((message) => {
      message.read = true
    })
  }
  if (input.index !== undefined && messages[input.index]) {
    messages[input.index].read = true
  }
  await writeInbox(file, messages)
  await Storage.write(["coord", "inbox", input.teamID, input.member], messages)
}

export async function broadcast(input: { teamID: string; from: string; recipients: string[]; content: string; summary: string }) {
  const payload: MessageInput = {
    type: "broadcast",
    from: input.from,
    content: input.content,
    summary: input.summary,
  }
  await Promise.all(
    input.recipients
      .filter((recipient) => recipient !== input.from)
      .map((recipient) =>
        sendMessage({
          teamID: input.teamID,
          recipient,
          message: payload,
        }),
      ),
  )
}

export async function loadCachedInbox(input: { teamID: string; member: string }) {
  return Storage.read<Message[]>(["coord", "inbox", input.teamID, input.member]).catch(() => [])
}

export function parseInbox(input: unknown) {
  if (!Array.isArray(input)) return []
  return input.map((item) => safeValidate(item)).filter((item): item is Message => !!item)
}

export async function upsertFromStorage(input: { teamID: string; member: string; messages: Message[] }) {
  const file = Paths.inboxFile(input.teamID, input.member)
  await Paths.ensureTeam(input.teamID)
  using _ = await Lock.write(file)
  await writeInbox(file, input.messages)
  await Storage.write(["coord", "inbox", input.teamID, input.member], input.messages)
}
