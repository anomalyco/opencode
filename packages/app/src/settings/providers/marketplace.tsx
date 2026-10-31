import type { MarketplaceMutationResult, MarketplacePlanResult, MarketplaceView } from "@opencode/client/promise"
import { Button } from "@opencode/ui/button"
import { Dialog, DialogBody, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { Switch } from "@opencode/ui/switch"
import { TextField } from "@opencode/ui/text-field"
import { createEffect, createResource, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"

export function DialogMarketplace(props: { directory: string }) {
  const language = useLanguage()
  const sdk = useServerSDK()
  const location = () => ({ directory: props.directory })
  const api = () => sdk.api.experimental.marketplace
  const [view, actions] = createResource(() =>
    api()
      .get({ location: location() })
      .then((result) => result.data),
  )
  const [store, setStore] = createStore<{
    query: string
    tab: "discover" | "installed" | "updates" | "sources"
    url: string
    header: string
    env: string
    busy: boolean
    error?: string
    plan?: Pick<
      Extract<MarketplacePlanResult, { ok: true }>,
      "plan_id" | "revision" | "summary" | "permissions" | "conflicts" | "trust_warning"
    >
    trust: boolean
    force: boolean
  }>({ tab: "discover", query: "", url: "", header: "", env: "", busy: false, trust: false, force: false })
  const current = (): MarketplaceView | undefined =>
    view.state === "ready" || view.state === "refreshing" ? view.latest : undefined
  const revision = () => current()?.state.revision ?? 0
  const listing = () =>
    (current()?.listings ?? []).filter(
      (item) =>
        (store.tab !== "installed" || !!current()?.state.installed?.[item.key]) &&
        (store.tab !== "updates" || item.status === "update") &&
        `${item.item.name} ${item.item.description} ${item.source.name}`
          .toLowerCase()
          .includes(store.query.toLowerCase()),
    )

  createEffect(() => {
    if (view.state === "errored") setStore("error", String(view.error))
  })
  const run = async (work: () => Promise<MarketplaceMutationResult>) => {
    if (store.busy) return
    setStore({ busy: true, error: undefined })
    try {
      const result = await work()
      if (!result.ok) {
        setStore("error", result.message)
        return false
      }
      actions.mutate(result.view)
      return true
    } catch (error) {
      setStore("error", error instanceof Error ? error.message : String(error))
      return false
    } finally {
      setStore("busy", false)
    }
  }
  const plan = async (key: string) => {
    if (store.busy) return
    setStore({ busy: true, error: undefined })
    try {
      const result = (await api().plan({ location: location(), key })).data
      if (!result.ok) return setStore("error", result.message)
      setStore({ plan: result, trust: false, force: false })
    } catch (error) {
      setStore("error", error instanceof Error ? error.message : String(error))
    } finally {
      setStore("busy", false)
    }
  }
  const updates = async () => {
    if (store.busy) return
    setStore({ busy: true, error: undefined })
    try {
      const result = (await api().updatePlan({ location: location() })).data
      if (!result.ok) return setStore("error", result.message)
      setStore({
        plan: {
          ...result,
          summary: language.t("marketplace.updates"),
          permissions: result.actions.map((item) => item.key),
        },
        trust: false,
        force: false,
      })
    } catch (error) {
      setStore("error", error instanceof Error ? error.message : String(error))
    } finally {
      setStore("busy", false)
    }
  }

  return (
    <Dialog size="x-large">
      <DialogHeader>
        <DialogTitleGroup title={language.t("marketplace.title")} description={language.t("marketplace.description")} />
      </DialogHeader>
      <DialogBody class="min-h-0 flex flex-col">
        <div data-scrollable class="min-h-0 overflow-y-auto flex flex-col gap-4 p-4">
          <div class="flex gap-2">
            <For each={["discover", "installed", "updates", "sources"] as const}>
              {(tab) => (
                <Button
                  variant={store.tab === tab ? "neutral" : "ghost"}
                  aria-pressed={store.tab === tab}
                  onClick={() => setStore("tab", tab)}
                >
                  {language.t(`marketplace.${tab}`)}
                </Button>
              )}
            </For>
          </div>
          <Show when={store.error}>
            <div role="alert">
              {language.t("marketplace.error")}: {store.error}
            </div>
          </Show>
          <Show when={store.plan}>
            {(pending) => (
              <section class="flex flex-col gap-2">
                <strong>{language.t("marketplace.preview")}</strong>
                <span>{pending().summary}</span>
                <strong>{language.t("marketplace.permissions")}</strong>
                <For each={pending().permissions}>{(permission) => <span>{permission}</span>}</For>
                <Show when={pending().conflicts.length}>
                  <strong>{language.t("marketplace.conflicts")}</strong>
                  <For each={pending().conflicts}>{(conflict) => <span>{conflict.path}</span>}</For>
                  <Switch checked={store.force} onChange={(value) => setStore("force", value)}>
                    {language.t("marketplace.force")}
                  </Switch>
                </Show>
                <Show when={pending().trust_warning}>
                  <Switch checked={store.trust} onChange={(value) => setStore("trust", value)}>
                    {language.t("marketplace.trust")}
                  </Switch>
                </Show>
                <div class="flex gap-2">
                  <Button
                    disabled={
                      store.busy ||
                      (pending().trust_warning && !store.trust) ||
                      (!!pending().conflicts.length && !store.force)
                    }
                    onClick={() => {
                      const prepared = pending()
                      void run(() =>
                        api()
                          .install({
                            location: location(),
                            plan_id: prepared.plan_id,
                            expected_revision: prepared.revision,
                            accept_untrusted: store.trust,
                            force: store.force,
                          })
                          .then((value) => value.data),
                      ).then((ok) => {
                        if (ok) setStore("plan", undefined)
                      })
                    }}
                  >
                    {language.t("marketplace.apply")}
                  </Button>
                  <Button variant="ghost" onClick={() => setStore("plan", undefined)}>
                    {language.t("marketplace.cancel")}
                  </Button>
                </div>
              </section>
            )}
          </Show>
          <Show when={store.tab === "sources"}>
            <section class="flex flex-col gap-2">
              <strong>{language.t("marketplace.sources")}</strong>
              <TextField
                label={language.t("marketplace.source")}
                value={store.url}
                onChange={(value) => setStore("url", value)}
              />
              <TextField
                label={language.t("marketplace.sourceHeader")}
                value={store.header}
                onChange={(value) => setStore("header", value)}
              />
              <TextField
                label={language.t("marketplace.sourceEnv")}
                value={store.env}
                onChange={(value) => setStore("env", value)}
              />
              <div class="flex gap-2">
                <Button
                  disabled={store.busy || !store.url || !!store.header !== !!store.env}
                  onClick={() =>
                    void run(() =>
                      api()
                        .sourceAdd({
                          location: location(),
                          expected_revision: revision(),
                          url: store.url,
                          header_env: store.header ? { [store.header]: store.env } : undefined,
                        })
                        .then((value) => value.data),
                    )
                  }
                >
                  {language.t("marketplace.sourceAdd")}
                </Button>
                <Button
                  variant="ghost"
                  disabled={store.busy}
                  onClick={() =>
                    void api()
                      .refresh({ location: location() })
                      .then((result) => actions.mutate(result.data))
                      .catch((error) => setStore("error", String(error)))
                  }
                >
                  {language.t("marketplace.refresh")}
                </Button>
              </div>
              <For each={current()?.state.sources ?? []}>
                {(source) => (
                  <div class="flex items-center justify-between gap-2">
                    <span>
                      {source.name} — {source.reference ?? source.url}
                    </span>
                    <div class="flex items-center gap-2">
                      <Switch
                        checked={source.enabled !== false}
                        disabled={store.busy}
                        onChange={(enabled) =>
                          void run(() =>
                            api()
                              .sourceToggle({
                                location: location(),
                                id: source.id,
                                enabled,
                                expected_revision: revision(),
                              })
                              .then((value) => value.data),
                          )
                        }
                      >
                        {source.name}
                      </Switch>
                      <Button
                        variant="ghost"
                        disabled={store.busy}
                        onClick={() =>
                          void run(() =>
                            api()
                              .sourceRemove({ location: location(), id: source.id, expected_revision: revision() })
                              .then((value) => value.data),
                          )
                        }
                      >
                        {language.t("marketplace.removeSource")}
                      </Button>
                    </div>
                  </div>
                )}
              </For>
            </section>
          </Show>
          <For each={current()?.errors ?? []}>
            {(error) => (
              <div role="alert">
                {language.t("marketplace.loadError")}: {error.source.name} — {error.message}
              </div>
            )}
          </For>
          <Show when={store.tab !== "sources"}>
            <Show when={store.tab === "updates"}>
              <Button disabled={store.busy} onClick={() => void updates()}>
                {language.t("marketplace.updateAll")}
              </Button>
            </Show>
            <TextField
              label={language.t("marketplace.search")}
              value={store.query}
              onChange={(value) => setStore("query", value)}
            />
            <Show when={listing().length} fallback={<span>{language.t("marketplace.empty")}</span>}>
              <For each={listing()}>
                {(item) => {
                  const installed = () => current()?.state.installed?.[item.key]
                  return (
                    <div class="flex flex-col gap-2">
                      <div class="flex items-center justify-between gap-3">
                        <div class="flex min-w-0 flex-col">
                          <strong>{item.item.name}</strong>
                          <span>{item.item.description}</span>
                          <span>
                            {item.source.name} · {item.item.version}
                          </span>
                          <Show when={item.compatibility?.compatible === false}>
                            <span>
                              {language.t("marketplace.incompatible")}: {item.compatibility?.reasons.join(", ")}
                            </span>
                          </Show>
                        </div>
                        <Show
                          when={installed()}
                          fallback={
                            <Button
                              disabled={store.busy || item.compatibility?.compatible === false}
                              onClick={() => void plan(item.key)}
                            >
                              {language.t("marketplace.install")}
                            </Button>
                          }
                        >
                          {(value) => (
                            <div class="flex items-center gap-2">
                              <Switch
                                checked={value().enabled !== false}
                                disabled={store.busy}
                                onChange={(enabled) =>
                                  void run(() =>
                                    api()
                                      .toggle({
                                        location: location(),
                                        key: item.key,
                                        expected_revision: revision(),
                                        component: "package",
                                        enabled,
                                      })
                                      .then((result) => result.data),
                                  )
                                }
                              >
                                {language.t(value().enabled === false ? "marketplace.enable" : "marketplace.disable")}
                              </Switch>
                              <Button
                                variant="ghost"
                                disabled={store.busy || item.orphaned}
                                onClick={() => void plan(item.key)}
                              >
                                {language.t("marketplace.update")}
                              </Button>
                              <Button
                                variant="ghost"
                                disabled={store.busy}
                                onClick={() =>
                                  void run(() =>
                                    api()
                                      .uninstall({ location: location(), key: item.key, expected_revision: revision() })
                                      .then((result) => result.data),
                                  )
                                }
                              >
                                {language.t("marketplace.uninstall")}
                              </Button>
                            </div>
                          )}
                        </Show>
                      </div>
                      <Show when={installed()}>
                        {(value) => (
                          <div class="flex flex-wrap gap-3">
                            <For each={value().plan.skills?.items ?? []}>
                              {(skill) => (
                                <Switch
                                  checked={!value().disabled_skills?.includes(skill.id)}
                                  disabled={store.busy || value().enabled === false}
                                  onChange={(enabled) =>
                                    void run(() =>
                                      api()
                                        .toggle({
                                          location: location(),
                                          key: item.key,
                                          expected_revision: revision(),
                                          component: "skill",
                                          id: skill.id,
                                          enabled,
                                        })
                                        .then((result) => result.data),
                                    )
                                  }
                                >
                                  {language.t("marketplace.skill")}: {skill.name}
                                </Switch>
                              )}
                            </For>
                            <For each={Object.keys(value().plan.mcp ?? {})}>
                              {(id) => (
                                <Switch
                                  checked={!value().disabled_mcp?.includes(id)}
                                  disabled={store.busy || value().enabled === false}
                                  onChange={(enabled) =>
                                    void run(() =>
                                      api()
                                        .toggle({
                                          location: location(),
                                          key: item.key,
                                          expected_revision: revision(),
                                          component: "mcp",
                                          id,
                                          enabled,
                                        })
                                        .then((result) => result.data),
                                    )
                                  }
                                >
                                  {language.t("marketplace.mcp")}: {id}
                                </Switch>
                              )}
                            </For>
                          </div>
                        )}
                      </Show>
                    </div>
                  )
                }}
              </For>
            </Show>
          </Show>
        </div>
      </DialogBody>
    </Dialog>
  )
}
