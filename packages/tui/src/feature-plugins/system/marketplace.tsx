import type { MarketplaceMutationResult } from "@opencode/client"
import { Plugin } from "@opencode/plugin/tui"
import { createResource, onMount } from "solid-js"
import { DialogConfirm } from "../../ui/dialog-confirm"
import { DialogPrompt } from "../../ui/dialog-prompt"
import { DialogSelect, type DialogSelectOption } from "../../ui/dialog-select"
import { useDialog } from "../../ui/dialog"
import { errorMessage } from "../../util/error"

function MarketplaceDialog(props: { context: Plugin.Context }) {
  const dialog = useDialog()
  const location = () => props.context.location ?? props.context.data.location.default()
  const api = props.context.client.experimental.marketplace
  const [view, { mutate }] = createResource(() => api.get({ location: location() }).then((result) => result.data))
  onMount(() => dialog.setSize("large"))
  const current = () => (view.state === "ready" || view.state === "refreshing" ? view.latest : undefined)
  const reopen = () => dialog.replace(() => <MarketplaceDialog context={props.context} />, undefined, { size: "large" })
  const notify = (error: unknown) => props.context.ui.toast.show({ variant: "error", message: errorMessage(error) })
  const apply = (request: Promise<{ data: MarketplaceMutationResult }>) =>
    void request
      .then((result) => {
        if (!result.data.ok) return notify(result.data.message)
        mutate(result.data.view)
        reopen()
      })
      .catch(notify)
  const options = (): DialogSelectOption<string>[] =>
    (current()?.listings ?? []).map((item) => ({
      title: item.item.name,
      value: item.key,
      description: item.item.description,
      category: item.source.name,
      footer: current()?.state.installed?.[item.key]
        ? "installed"
        : item.compatibility?.compatible === false
          ? "incompatible"
          : item.item.version,
      disabled: item.compatibility?.compatible === false && !current()?.state.installed?.[item.key],
    }))
  const install = (key: string) => {
    const snapshot = current()
    if (!snapshot) return
    const installed = snapshot.state.installed?.[key]
    if (installed) {
      dialog.replace(() => (
        <DialogSelect
          title={installed.name}
          options={[
            { title: installed.enabled === false ? "Enable" : "Disable", value: "toggle" },
            { title: "Uninstall", value: "uninstall" },
            { title: "Review update", value: "update" },
            ...(installed.plan.skills?.items ?? []).map((skill) => ({
              title: `${installed.disabled_skills?.includes(skill.id) ? "Enable" : "Disable"} skill: ${skill.name}`,
              value: `skill:${skill.id}`,
            })),
            ...Object.keys(installed.plan.mcp ?? {}).map((name) => ({
              title: `${installed.disabled_mcp?.includes(name) ? "Enable" : "Disable"} MCP: ${name}`,
              value: `mcp:${name}`,
            })),
          ]}
          onSelect={(option) => {
            if (option.value === "toggle")
              return apply(
                api.toggle({
                  location: location(),
                  key,
                  component: "package",
                  enabled: installed.enabled === false,
                  expected_revision: snapshot.state.revision ?? 0,
                }),
              )
            if (option.value === "uninstall")
              return apply(
                api.uninstall({ location: location(), key, expected_revision: snapshot.state.revision ?? 0 }),
              )
            if (option.value.startsWith("skill:")) {
              const id = option.value.slice(6)
              return apply(
                api.toggle({
                  location: location(),
                  key,
                  component: "skill",
                  id,
                  enabled: installed.disabled_skills?.includes(id) ?? false,
                  expected_revision: snapshot.state.revision ?? 0,
                }),
              )
            }
            if (option.value.startsWith("mcp:")) {
              const id = option.value.slice(4)
              return apply(
                api.toggle({
                  location: location(),
                  key,
                  component: "mcp",
                  id,
                  enabled: installed.disabled_mcp?.includes(id) ?? false,
                  expected_revision: snapshot.state.revision ?? 0,
                }),
              )
            }
            prepare(key)
          }}
        />
      ))
      return
    }
    prepare(key)
  }
  const prepare = (key: string) => {
    void api
      .plan({ location: location(), key })
      .then((result) => {
        const plan = result.data
        if (!plan.ok) return notify(plan.message)
        const message = [
          plan.summary,
          ...plan.permissions,
          ...plan.conflicts.map((item) => `Conflict: ${item.path}`),
          ...(plan.trust_warning ? ["This catalog is untrusted. Confirm only if you trust its contents."] : []),
        ].join("\n")
        dialog.replace(() => (
          <DialogConfirm
            title="Install Marketplace package?"
            message={message}
            onConfirm={() => {
              void api
                .install({
                  location: location(),
                  plan_id: plan.plan_id,
                  expected_revision: plan.revision,
                  accept_untrusted: plan.trust_warning,
                  force: plan.conflicts.length > 0,
                })
                .then((value) => {
                  if (!value.data.ok) return notify(value.data.message)
                  props.context.ui.toast.show({ variant: "success", message: "Marketplace package installed" })
                  reopen()
                })
                .catch(notify)
            }}
          />
        ))
      })
      .catch(notify)
  }
  const add = () =>
    dialog.replace(() => (
      <DialogPrompt
        title="Add Marketplace source"
        placeholder="Catalog URL or path"
        onConfirm={(url) => {
          const snapshot = current()
          if (!snapshot) return
          apply(api.sourceAdd({ location: location(), url, expected_revision: snapshot.state.revision ?? 0 }))
        }}
        onCancel={reopen}
      />
    ))
  const sources = () => {
    const snapshot = current()
    if (!snapshot) return
    dialog.replace(() => (
      <DialogSelect
        title="Marketplace sources"
        options={(snapshot.state.sources ?? []).map((source) => ({
          title: source.name,
          description: source.reference ?? source.url,
          footer: source.enabled === false ? "disabled" : "enabled",
          value: source.id,
        }))}
        onSelect={(option) => {
          const source = snapshot.state.sources?.find((item) => item.id === option.value)
          if (!source) return
          dialog.replace(() => (
            <DialogSelect
              title={source.name}
              options={[
                { title: source.enabled === false ? "Enable" : "Disable", value: "toggle" },
                { title: "Remove source", value: "remove" },
              ]}
              onSelect={(action) =>
                apply(
                  action.value === "remove"
                    ? api.sourceRemove({
                        location: location(),
                        id: source.id,
                        expected_revision: snapshot.state.revision ?? 0,
                      })
                    : api.sourceToggle({
                        location: location(),
                        id: source.id,
                        expected_revision: snapshot.state.revision ?? 0,
                        enabled: source.enabled === false,
                      }),
                )
              }
            />
          ))
        }}
      />
    ))
  }
  return (
    <DialogSelect
      title="Marketplace"
      options={options()}
      preserveSelection
      onSelect={(option) => install(option.value)}
      actions={[
        { command: "marketplace.add", title: "Add source", bind: "ctrl+a", selection: "none", onTrigger: add },
        { command: "marketplace.sources", title: "Sources", bind: "ctrl+s", selection: "none", onTrigger: sources },
        {
          command: "marketplace.refresh",
          title: "Refresh",
          bind: "ctrl+r",
          selection: "none",
          onTrigger: () =>
            void api
              .refresh({ location: location() })
              .then((result) => mutate(result.data))
              .catch(notify),
        },
      ]}
    />
  )
}

function Commands(props: { context: Plugin.Context }) {
  props.context.keymap.layer(() => ({
    mode: "global",
    commands: [
      {
        id: "marketplace.list",
        title: "Marketplace",
        group: "System",
        slash: { name: "marketplace" },
        palette: true,
        run() {
          props.context.ui.dialog.show(() => <MarketplaceDialog context={props.context} />)
        },
      },
    ],
  }))
  return null
}

export default Plugin.define({
  id: "opencode.marketplace",
  setup(context) {
    context.ui.slot({ append: "app", render: () => <Commands context={context} /> })
  },
})
