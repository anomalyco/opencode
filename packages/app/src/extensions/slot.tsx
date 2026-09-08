import {
  createComponent,
  createMemo,
  createRoot,
  ErrorBoundary,
  For,
  getOwner,
  onCleanup,
  onMount,
  Show,
  type JSX,
  type ParentProps,
} from "solid-js"
import { PanelProvider, PluginProvider, NativeSurfaceProvider } from "@opencode/plugin/desktop/solid"
import type { PanelInput, SlotMap, SlotPath } from "@opencode/plugin/desktop/context"
import { emptySlotted } from "@opencode/plugin/slots"
import { useLanguage } from "@/runtime/i18n/language"
import { showToast } from "@/shell/notifications/toast"
import { useOptionalDesktopExtensions, type Contribution } from "./provider"
import { extensionTabKey } from "./keys"
import { ExtensionNativeSurface } from "./native-surface"

export function ExtensionSlot<Path extends SlotPath>(props: ParentProps<{ path: Path; input?: SlotMap[Path] }>) {
  const host = useOptionalDesktopExtensions()
  if (!host) return props.children
  const language = useLanguage()
  const slotted = createMemo(() => host.resolved().slotted.get(props.path) ?? emptySlotted<Contribution["render"]>())
  const contribution = (claim: Contribution) => (
    <ErrorBoundary
      fallback={(error) => {
        host.failed(claim.plugin)
        onMount(() =>
          showToast({
            variant: "error",
            title: language.t("common.requestFailed"),
            description: `${claim.plugin}: ${String(error)}`,
          }),
        )
        return null
      }}
    >
      <PluginProvider value={claim.render.context}>
        <NativeSurfaceProvider
          render={(surface) => <ExtensionNativeSurface extensionID={claim.plugin} id={surface.id} />}
        >
          <Show
            when={props.path === "session.panel"}
            fallback={createComponent(claim.render.render as (input: object) => JSX.Element, props.input ?? {})}
          >
            <PanelProvider
              value={{
                get session() {
                  return (props.input as PanelInput).session
                },
                register(panel) {
                  const owner = getOwner()
                  const session = (props.input as PanelInput).session
                  const render = (value: () => JSX.Element) => {
                    const mounted = createRoot((dispose) => ({ dispose, view: value() }), owner)
                    onCleanup(mounted.dispose)
                    return mounted.view
                  }
                  onCleanup(
                    host.register({
                      key: panel.reference ?? extensionTabKey(claim.plugin, panel.id),
                      plugin: claim.plugin,
                      generation: claim.render.generation,
                      session,
                      props: panel,
                      render: () => render(() => panel.children),
                      icon: () => render(() => panel.icon),
                    }),
                  )
                },
              }}
            >
              {createComponent(claim.render.render as (input: object) => JSX.Element, props.input ?? {})}
            </PanelProvider>
          </Show>
        </NativeSurfaceProvider>
      </PluginProvider>
    </ErrorBoundary>
  )
  return (
    <>
      <For each={slotted().before}>{contribution}</For>
      <Show
        when={slotted().replace}
        keyed
        fallback={
          <>
            <For each={slotted().prepend}>{contribution}</For>
            {props.children}
            <For each={slotted().append}>{contribution}</For>
          </>
        }
      >
        {contribution}
      </Show>
      <For each={slotted().after}>{contribution}</For>
    </>
  )
}
