export * as EffectSdk from "./effect"

import { OpenCode } from "@opencode/client/effect"
import { Session } from "@opencode/core/session"
import type { Workspace } from "@opencode/core/workspace"
import { Effect } from "effect"
import type { Config, Scope } from "effect"
import { FetchHttpClient, HttpClient } from "effect/http"
import type { CreateOptions, Interface } from "../effect/opencode"
import { EmbeddedHost } from "./host"

/** `OpenCode.create` with the host hooks a runtime profile (such as workerd) needs. */
export const create = <R = never>(
  options?: CreateOptions<R>,
  embed?: EmbeddedHost.EmbedOptions,
): Effect.Effect<Interface, Config.ConfigError | Error, Scope.Scope | R> =>
  Effect.map(createWithHost(options, embed), (created) => created.sdk)

/** `create`, returning the host too. */
export const createWithHost: <R = never>(
  options?: CreateOptions<R>,
  embed?: EmbeddedHost.EmbedOptions,
) => Effect.Effect<
  { readonly sdk: Interface; readonly host: EmbeddedHost.Interface },
  Config.ConfigError | Error,
  Scope.Scope | R
> = Effect.fn("OpenCode.create")(function* <R = never>(
  options: CreateOptions<R> = {},
  embed: EmbeddedHost.EmbedOptions = {},
) {
  const host = yield* Effect.acquireRelease(EmbeddedHost.create(options, embed), (host) => Effect.promise(host.close))
  const httpClient = yield* HttpClient.HttpClient.pipe(Effect.provide(FetchHttpClient.layer))
  const client = yield* OpenCode.make({ baseUrl: "http://opencode.local" }).pipe(
    Effect.provideService(
      HttpClient.HttpClient,
      // FetchHttpClient reads Fetch at request time; callers must not replace this host's in-process transport.
      HttpClient.transformResponse(httpClient, Effect.provideService(FetchHttpClient.Fetch, host.fetch)),
    ),
  )

  const sdk: Interface = {
    ...client,
    sessions: {
      ...client.session,
      create: host.sessions.create,
      get: (input: { readonly sessionID: Session.ID }) => host.sessions.get(input.sessionID),
      move: host.sessions.move,
    },
    events: client.event,
    workspace: {
      create: host.workspace.create,
      attach: host.workspace.attach,
      provision: ({ workspaceID }: { readonly workspaceID: Workspace.ID }) => host.workspace.provision(workspaceID),
      destroy: ({ workspaceID }: { readonly workspaceID: Workspace.ID }) => host.workspace.destroy(workspaceID),
      suspendIdle: host.workspace.suspendIdle,
    },
    plugin: Object.assign(host.plugins.register, client.plugin),
  }
  return { sdk, host }
})
