import { notifySessionTabsRemoved } from "@/components/titlebar-session-events"

type HomeSession = {
  id: string
  directory: string
}

type SessionUpdate = {
  directory: string
  sessionID: string
  time: { archived: number }
}

export async function archiveHomeSession(input: {
  session: HomeSession
  update: (value: SessionUpdate) => Promise<unknown>
  remove: () => void
}) {
  await input.update({
    directory: input.session.directory,
    sessionID: input.session.id,
    time: { archived: Date.now() },
  })
  input.remove()
  notifySessionTabsRemoved({ directory: input.session.directory, sessionIDs: [input.session.id] })
}
