import type { Route } from "../context/route"

type RefreshProviderSessionDeps = {
  route: { data: Route }
  sdk: {
    client: {
      instance: {
        dispose(): Promise<unknown>
      }
    }
  }
  sync: {
    bootstrap(): Promise<unknown>
    session: {
      sync(sessionID: string, opts?: { force?: boolean }): Promise<unknown> | unknown
    }
  }
}

export async function refreshProviderSession(deps: RefreshProviderSessionDeps) {
  await deps.sdk.client.instance.dispose()
  await deps.sync.bootstrap()
  if (deps.route.data.type !== "session") return
  await deps.sync.session.sync(deps.route.data.sessionID, { force: true })
}
