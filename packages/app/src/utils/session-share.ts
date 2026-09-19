export type SessionShareClient = {
  session: {
    share: (input: { sessionID: string }) => Promise<{ data?: { share?: { url?: string } } | null }>
    unshare: (input: { sessionID: string }) => Promise<unknown>
  }
}

export async function publishSession(client: SessionShareClient, sessionID: string) {
  const url = (await client.session.share({ sessionID })).data?.share?.url
  if (!url) throw new Error("Session share URL missing")
  return url
}

export async function unpublishSession(client: SessionShareClient, sessionID: string) {
  await client.session.unshare({ sessionID })
}
