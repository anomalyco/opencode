import { useDialog } from "@opencode/ui/context/dialog"
import { createEffect, createMemo, createSignal, on, onCleanup, untrack } from "solid-js"
import { consoleCatalogLoaded, consoleProviderGroup } from "@/providers/catalog/console"
import { createConsoleCatalogSettler } from "@/providers/catalog/console-settle"
import { useIntegrations } from "@/providers/catalog/integrations"
import { useProviders } from "@/providers/catalog/providers"
import type { ModelSelection } from "@/providers/models/selection"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { useServerSDK } from "@/runtime/server/client"
import { useData } from "@/runtime/server/current"
import { formatServerError } from "@/runtime/server/errors"
import { ServerConnection } from "@/runtime/server/registry"
import { useGlobal } from "@/runtime/server/runtime"
import { useProviderAccountActions } from "@/settings/providers/account-actions"
import { providerAccounts, type ProviderAccount } from "@/settings/providers/accounts"
import { showToast } from "@/shell/notifications/toast"
import { useTabs } from "@/shell/tabs/tabs"
import {
  CLAUDE_AGENT_INTEGRATION,
  CONSOLE_INTEGRATION,
  createProviderDialogState,
  selectProviderDialogView,
  transitionProviderDialog,
  type ProviderAccounts,
  type ProviderDialogEffect,
  type ProviderDialogEvent,
} from "./dialog-machine"
import { connectMethods, type ProviderConnectEffect, type ProviderConnectEvent } from "./machine"

export function createProviderDialogController(options: {
  /** The Location a sign-in belongs to, fixed when the dialog opens. */
  directory: string | undefined
  standalone: boolean
  /** The caller's selected provider; the dialog follows it and writes its own selection back. */
  selected: () => string | undefined
  onSelect: (provider: string | undefined) => void
  selection?: ModelSelection
  onConnected?: (provider: string) => void
}) {
  const language = useLanguage()
  const platform = usePlatform()
  const serverSDK = useServerSDK()
  const data = useData()
  const global = useGlobal()
  const tabs = useTabs()
  const dialog = useDialog()
  const directory = () => options.directory
  const location = options.directory ? { directory: options.directory } : undefined
  const providers = useProviders(directory)
  const integrations = useIntegrations(directory)
  const accountActions = useProviderAccountActions(directory)
  // Not createResource: the dialog is owned by whichever page opened it, so reading a pending
  // resource here would suspend that page's <Suspense> and blank the screen behind the dialog.
  const [machine, setMachine] = createSignal(createProviderDialogState({ standalone: options.standalone }))
  const view = createMemo(() => selectProviderDialogView(machine()))
  const queue: ProviderDialogEvent[] = []
  let draining = false
  // The machine decides when polling and the Claude check stop; these only hold the timers.
  let pollTimer: ReturnType<typeof setTimeout> | undefined
  let claudeTimer: ReturnType<typeof setTimeout> | undefined

  const provider = createMemo(() => {
    const state = machine()

    return state.status === "provider" ? state.provider : undefined
  })

  const serverAccounts = (id: string) => providerAccounts(integrations.list().find((item) => item.id === id))

  // The server lists the active account first. For Claude Agent its status is the latest check of `claude`.
  const accountsOf = (id: string): ProviderAccounts => {
    const list = serverAccounts(id)

    return { count: list.length, activeID: list[0]?.id, problem: !!list[0]?.status }
  }

  const providerName = createMemo(() => {
    const id = provider()

    if (!id) return ""

    return (
      integrations.list().find((item) => item.id === id)?.name ??
      providers.all().get(id)?.name ??
      view().connect?.integration?.name ??
      id
    )
  })

  const connectionProviders = createMemo(() => {
    const id = provider()

    if (!id) return []

    return (data.location.provider.list(location) ?? []).filter((item) => item.id === id || item.integrationID === id)
  })

  const connectionModels = createMemo(() => {
    const ids = new Set(connectionProviders().map((item) => item.id))

    return (data.location.model.list(location) ?? []).filter(
      (model) => ids.has(model.providerID) && model.enabled && model.status !== "deprecated",
    )
  })

  const connectionGroups = createMemo(() => {
    const models = connectionModels()

    return connectionProviders()
      .map((item) => ({ provider: item, models: models.filter((model) => model.providerID === item.id) }))
      .filter((group) => group.models.length > 0)
  })

  const managedProviders = createMemo(() =>
    provider() === CONSOLE_INTEGRATION ? consoleProviderGroup(connectionProviders()) : undefined,
  )

  const firstModel = () => {
    const model = connectionGroups()[0]?.models[0]

    return model ? modelKey(model) : undefined
  }

  const settler = createConsoleCatalogSettler({
    isLoaded: () => consoleCatalogLoaded(connectionProviders()),
    sync: () => {
      data.location.provider.invalidate(location)
      data.location.model.invalidate(location)

      return Promise.all([data.location.provider.sync(location), data.location.model.sync(location)]).then(
        () => undefined,
      )
    },
  })

  // Effects run in order and one that throws cannot stop the events queued after it.
  const dispatch = (event: ProviderDialogEvent) => {
    queue.push(event)

    if (draining) return
    draining = true

    try {
      while (queue.length > 0) {
        try {
          const result = transitionProviderDialog(untrack(machine), queue[0])
          setMachine(result.state)
          result.effects.forEach((effect) => void Promise.try(() => run(effect)).catch(console.error))
        } finally {
          queue.shift()
        }
      }
    } finally {
      draining = false
    }
  }

  const run = (effect: ProviderDialogEffect) => {
    if (effect.type === "connect.effect") return runConnect(effect)

    if (effect.type === "controller.sync") return options.onSelect(effect.provider)

    if (effect.type === "account.activate") {
      const account = serverAccounts(effect.provider).find((item) => item.id === effect.accountID)
      const name = providerName()
      void Promise.try(
        () => account && accountActions.activate({ integrationID: effect.provider, provider: name, account }),
      )
        .catch(() => undefined)
        .then(() => dispatch({ type: "account.activate.settled", session: effect.session, attempt: effect.attempt }))

      return
    }

    if (effect.type === "account.remove") {
      const account = serverAccounts(effect.provider).find((item) => item.id === effect.accountID)
      const name = providerName()
      void Promise.try(
        () =>
          account &&
          accountActions.remove({ integrationID: effect.provider, provider: name, account, final: effect.final }),
      )
        .catch(() => undefined)
        .then(() => dispatch({ type: "account.remove.settled", session: effect.session, attempt: effect.attempt }))

      return
    }

    if (effect.type === "claude.replace") {
      void Promise.all(
        effect.credentialIDs.map((credentialID) =>
          serverSDK.api.credential.remove({ credentialID }).catch(() => undefined),
        ),
      )

      return
    }

    if (effect.type === "claude.timer.start") {
      clearTimeout(claudeTimer)
      claudeTimer = setTimeout(
        () => dispatch({ type: "claude.timed-out", session: effect.session, check: effect.check }),
        effect.timeoutMs,
      )

      return
    }

    if (effect.type === "claude.timer.stop") {
      clearTimeout(claudeTimer)
      claudeTimer = undefined

      return
    }

    // A signed-out `claude` still lists its models, and the login problem arrives in a separate event,
    // so read the connection again before treating the models as a working login.
    if (effect.type === "claude.confirm") {
      data.location.integration.invalidate(location)
      void data.location.integration
        .sync(location)
        .catch(() => undefined)
        .then(() =>
          dispatch({
            type: "claude.confirmed",
            session: effect.session,
            check: effect.check,
            hasProblem: accountsOf(CLAUDE_AGENT_INTEGRATION).problem,
            firstModel: firstModel(),
          }),
        )

      return
    }

    if (effect.type === "settle.cancel") return settler.cancel()

    if (effect.type === "models.reveal")
      return global.models.show(
        connectionModels().map((model) => ({ providerID: model.providerID, modelID: model.id })),
      )

    if (effect.type === "connected.notify") return options.onConnected?.(effect.provider)

    if (effect.type === "toast.connected") {
      const name = providerName()
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("provider.connect.toast.connected.title", { provider: name }),
        description:
          connectionModels().length > 0
            ? language.t("provider.connect.toast.connected.description", { provider: name })
            : undefined,
      })

      return
    }

    if (effect.type === "dialog.close") return dialog.close()

    if (options.selection) return options.selection.set(effect.selection)
    void tabs.newDraft(
      {
        server: ServerConnection.key(serverSDK.server),
        directory: options.directory ?? data.location.default().directory,
      },
      undefined,
      effect.selection,
    )
  }

  const runConnect = (input: Extract<ProviderDialogEffect, { type: "connect.effect" }>) => {
    const effect = input.effect
    const integrationID = input.provider
    const isConsole = integrationID === CONSOLE_INTEGRATION

    const result = (event: ProviderConnectEvent, catalog?: { pending: boolean; firstModel: string | undefined }) =>
      dispatch({ type: "connect.result", session: input.session, provider: integrationID, event, catalog })

    if (effect.type === "load") {
      void serverSDK.api.integration
        .get({ integrationID, location })
        .then((response) => response.data)
        .catch(() => undefined)
        .then((integration) =>
          result({
            type: "integration.loaded",
            attempt: effect.attempt,
            // An integration the server could not describe can still take an API key; one it describes
            // without interactive methods (environment only) has nothing to connect here.
            catalog: {
              integration,
              methods: integration
                ? connectMethods(integration)
                : [{ type: "key", label: language.t("provider.connect.method.apiKey") }],
            },
            // The dialog machine decides from its step whether a lone method starts on its own.
            manual: false,
          }),
        )

      return
    }

    if (effect.type === "start") return start(effect, integrationID, result)

    if (effect.type === "open.browser") {
      void Promise.resolve()
        .then(() => {
          if (platform.openBrowser) return platform.openBrowser(effect.url)
          platform.openExternal(effect.url)

          return true
        })
        .catch(() => false)
        .then((opened) => result({ type: "browser.opened", attemptID: effect.attemptID, opened }))

      return
    }

    // Desktop opens the browser over IPC, which can hang; a launch that does not answer in time counts as failed, so
    // the form shows the link to open by hand.
    if (effect.type === "form.open.browser") {
      const timeout = Promise.withResolvers<boolean>()
      const timer = setTimeout(() => timeout.resolve(false), effect.timeoutMs)
      void Promise.race([
        Promise.try(() => {
          if (platform.openBrowser) return platform.openBrowser(effect.url)
          platform.openExternal(effect.url)

          return true
        }).catch(() => false),
        timeout.promise,
      ]).then((opened) => {
        clearTimeout(timer)
        result({ type: "form.browser.opened", attempt: effect.attempt, browser: effect.browser, opened })
      })

      return
    }

    if (effect.type === "poll") {
      clearTimeout(pollTimer)
      pollTimer = undefined

      if (!effect.delay) return poll(effect, integrationID, result)
      const interval = effect.signIn.kind === "command" ? 500 : isConsole ? 500 : 1_000
      pollTimer = setTimeout(() => poll(effect, integrationID, result), interval)

      return
    }

    if (effect.type === "poll.stop") {
      clearTimeout(pollTimer)
      pollTimer = undefined

      return
    }

    if (effect.type === "cancel") {
      const request = { integrationID, attemptID: effect.attemptID, location }

      const cancel: Promise<unknown> =
        effect.target === "command"
          ? serverSDK.api.integration.command.cancel(request)
          : serverSDK.api.integration.oauth.cancel(request)

      void cancel.catch(() => undefined)

      return
    }

    if (effect.type === "submit") {
      const request: Promise<unknown> =
        effect.signIn.kind === "key"
          ? serverSDK.api.integration.connect.key({ integrationID, location, key: effect.value, answer: effect.answer })
          : serverSDK.api.integration.oauth.complete({
              integrationID,
              attemptID: effect.signIn.authorization.attemptID,
              location,
              code: effect.value,
            })

      const fallback = effect.signIn.kind === "code" ? language.t("provider.connect.oauth.code.invalid") : undefined
      void request.then(
        () => result({ type: "submit.succeeded", attempt: effect.attempt }),
        (error) =>
          result({
            type: "submit.failed",
            attempt: effect.attempt,
            error: formatServerError(error, language.t, fallback),
          }),
      )

      return
    }

    if (effect.type === "paste") {
      void serverSDK.api.integration.oauth
        .complete({ integrationID, attemptID: effect.signIn.authorization.attemptID, location, code: effect.value })
        .then(
          () => result({ type: "paste.accepted", attempt: effect.attempt }),
          (error) =>
            result({ type: "paste.rejected", attempt: effect.attempt, error: formatServerError(error, language.t) }),
        )

      return
    }

    if (effect.type === "sync") return void sync()

    void refresh(effect, integrationID, result)
  }

  const start = (
    effect: Extract<ProviderConnectEffect, { type: "start" }>,
    integrationID: string,
    result: (event: ProviderConnectEvent) => void,
  ) => {
    const isConsole = integrationID === CONSOLE_INTEGRATION
    const failed = (error: string) => result({ type: "start.failed", attempt: effect.attempt, error })

    if (effect.method.type === "command") {
      void serverSDK.api.integration.command.connect({ integrationID, methodID: effect.method.id, location }).then(
        (response) => result({ type: "command.started", attempt: effect.attempt, command: response.data }),
        (error) => failed(formatServerError(error, language.t)),
      )

      return
    }

    const input = { integrationID, methodID: effect.method.id, answer: effect.answer, location }

    if (effect.method.type === "external") {
      void serverSDK.api.integration.connect.external(input).then(
        () => result({ type: "external.saved", attempt: effect.attempt }),
        (error) => failed(formatServerError(error, language.t)),
      )

      return
    }

    void serverSDK.api.integration.oauth.connect(input).then(
      (response) => {
        if (!isConsole || platform.platform !== "desktop")
          return result({ type: "oauth.started", attempt: effect.attempt, authorization: response.data })
        const url = new URL(response.data.url)
        url.searchParams.set("client_id", "opencode-desktop")
        // Lets the Console return link focus the window that started the sign-in.
        url.searchParams.set("return_window", platform.windowID)
        result({ type: "oauth.started", attempt: effect.attempt, authorization: { ...response.data, url: url.href } })
      },
      (error) =>
        failed(isConsole ? language.t("provider.connect.console.startFailed") : formatServerError(error, language.t)),
    )
  }

  const poll = (
    effect: Extract<ProviderConnectEffect, { type: "poll" }>,
    integrationID: string,
    result: (event: ProviderConnectEvent) => void,
  ) => {
    const isConsole = integrationID === CONSOLE_INTEGRATION

    const polled = (outcome: Extract<ProviderConnectEvent, { type: "polled" }>["outcome"]) =>
      result({ type: "polled", attempt: effect.attempt, outcome })

    if (effect.signIn.kind === "command") {
      void serverSDK.api.integration.command
        .status({ integrationID, attemptID: effect.signIn.command.attemptID, location })
        .then(
          (response) => {
            const status = response.data

            if (status.status === "pending") return polled({ status: "pending", output: status.message ?? "" })

            if (status.status === "complete") return polled({ status: "complete" })

            polled({
              status: "failed",
              error: status.status === "failed" ? status.message : language.t("provider.connect.command.expired"),
            })
          },
          (error) => polled({ status: "failed", error: formatServerError(error, language.t) }),
        )

      return
    }

    void serverSDK.api.integration.oauth
      .status({ integrationID, attemptID: effect.signIn.authorization.attemptID, location })
      .then(
        (response) => {
          const status = response.data

          if (status.status === "pending") return polled({ status: "pending" })

          if (status.status === "complete") return polled({ status: "complete" })

          if (status.status === "expired")
            return polled({
              status: "failed",
              error: language.t(isConsole ? "provider.connect.console.expired" : "provider.connect.oauth.expired"),
            })

          polled({
            status: "failed",
            error:
              isConsole && status.message.includes("expired_token")
                ? language.t("provider.connect.console.expired")
                : isConsole && status.message.includes("access_denied")
                  ? language.t("provider.connect.console.denied")
                  : status.message,
          })
        },
        (error) =>
          polled({
            status: "unreachable",
            error: isConsole
              ? language.t("provider.connect.console.statusFailed")
              : formatServerError(error, language.t),
          }),
      )
  }

  const sync = () => {
    data.location.integration.invalidate(location)
    data.location.provider.invalidate(location)
    data.location.model.invalidate(location)

    return Promise.all([
      data.location.integration.sync(location),
      data.location.provider.sync(location),
      data.location.model.sync(location),
    ])
      .then(() => true)
      .catch(() => false)
  }

  // The server loads the Console workspace's providers after the grant lands, so the first refresh
  // can still show only the free catalog. Wait briefly for the workspace providers before moving on.
  const refresh = async (
    effect: Extract<ProviderConnectEffect, { type: "refresh" }>,
    integrationID: string,
    result: (event: ProviderConnectEvent, catalog?: { pending: boolean; firstModel: string | undefined }) => void,
  ) => {
    const refreshed = await sync()

    if (integrationID !== CONSOLE_INTEGRATION)
      return result(
        { type: "refresh.succeeded", attempt: effect.attempt },
        { pending: false, firstModel: firstModel() },
      )

    if (!refreshed)
      return result({
        type: "refresh.failed",
        attempt: effect.attempt,
        error: language.t("provider.connect.console.refreshFailed"),
      })

    const outcome = effect.method.type === "key" ? "loaded" : await settler.settle()

    // Back or closing the dialog already moved on and stopped the wait.
    if (outcome === "cancelled") return
    result(
      { type: "refresh.succeeded", attempt: effect.attempt },
      { pending: outcome === "timed-out", firstModel: firstModel() },
    )
  }

  const claudePhase = createMemo(() => {
    const state = machine()

    return state.status === "provider" && state.step.kind === "claude" ? state.step.phase.status : undefined
  })

  const claudeProblem = () =>
    provider() === CLAUDE_AGENT_INTEGRATION ? serverAccounts(CLAUDE_AGENT_INTEGRATION)[0]?.status : undefined

  const initial = untrack(options.selected)

  if (initial)
    dispatch({ type: "provider.selected", provider: initial, fromPicker: false, accounts: accountsOf(initial) })

  createEffect(
    on(
      options.selected,
      (selected) => {
        if (selected === untrack(provider)) return

        if (!selected) return dispatch({ type: "provider.cleared" })
        dispatch({ type: "provider.selected", provider: selected, fromPicker: false, accounts: accountsOf(selected) })
      },
      { defer: true },
    ),
  )

  createEffect(() => {
    const id = provider()

    if (!id) return
    const accounts = accountsOf(id)
    untrack(() => dispatch({ type: "accounts.synced", accounts }))
  })

  createEffect(
    on(
      [claudePhase, () => !!claudeProblem(), () => connectionGroups().length > 0],
      ([phase, hasProblem, hasModels]) => {
        if (phase) dispatch({ type: "claude.status.changed", hasProblem, hasModels })
      },
    ),
  )

  onCleanup(() => dispatch({ type: "disposed" }))

  return {
    view,
    dispatch,
    providerName,
    connectionModels,
    connectionGroups,
    managedProviders,
    claudeProblem,
    // Sorted by name so rows stay put when the server moves the active account first.
    accounts: () => {
      const id = provider()

      return id ? serverAccounts(id).toSorted((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id)) : []
    },
    select: (id: string) =>
      dispatch({ type: "provider.selected", provider: id, fromPicker: true, accounts: accountsOf(id) }),
    input: (event: ProviderConnectEvent) => dispatch({ type: "connect.input", event }),
    rename: accountActions.rename,
    back: () => dispatch({ type: "back" }),
    checkClaude: () => {
      const id = provider()

      if (id) dispatch({ type: "claude.check", replacing: serverAccounts(id).map((account) => account.id) })
    },
    // A connection that needs a fresh sign-in either has its own link or signs in again.
    chooseAccount: (account: ProviderAccount) => {
      if (account.status?.url) return void platform.openExternal(account.status.url)

      if (account.status) return dispatch({ type: "account.add" })
      dispatch({ type: "account.activate.requested", accountID: account.id })
    },
    copyLink: async () => {
      const state = untrack(machine)
      const authorization = untrack(view).connect?.authorization

      if (!authorization) return

      const copied = await Promise.resolve()
        .then(() =>
          platform.writeClipboardText
            ? platform.writeClipboardText(authorization.url)
            : navigator.clipboard.writeText(authorization.url),
        )
        .then(() => true)
        .catch(() => false)

      dispatch({ type: "link.copied", session: state.session, attemptID: authorization.attemptID, copied })
    },
  }
}

export const modelKey = (model: { providerID: string; id: string }) => `${model.providerID}:${model.id}`
