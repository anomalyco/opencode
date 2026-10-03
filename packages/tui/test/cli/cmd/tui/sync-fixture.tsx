/** @jsxImportSource @opentui/solid */
import { testRender } from "@opentui/solid"
import { onMount } from "solid-js"
import { ArgsProvider, type Args } from "../../../../src/context/args"
import { KVProvider, useKV } from "../../../../src/context/kv"
import { ProjectProvider, useProject } from "../../../../src/context/project"
import { SDKProvider } from "../../../../src/context/sdk"
import { SyncProvider, useSync } from "../../../../src/context/sync"
import { PermissionProvider, usePermission } from "../../../../src/context/permission"
import { RouteProvider, useRoute, type Route } from "../../../../src/context/route"
import { ToastProvider, useToast } from "../../../../src/ui/toast"
import { ExitProvider } from "../../../../src/context/exit"
import { createEventSource, createFetch, type FetchHandler, directory } from "../../../fixture/tui-sdk"
import { TestTuiContexts } from "../../../fixture/tui-environment"
export { createEventSource, createFetch, directory, eventSource, json, worktree } from "../../../fixture/tui-sdk"

export async function wait(fn: () => boolean, timeout = 2000) {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting for condition")
    await Bun.sleep(10)
  }
}

type Ctx = {
  kv: ReturnType<typeof useKV>
  permission: ReturnType<typeof usePermission>
  project: ReturnType<typeof useProject>
  route: ReturnType<typeof useRoute>
  sync: ReturnType<typeof useSync>
  toast: ReturnType<typeof useToast>
}

export async function mount(override?: FetchHandler, state?: string, args: Args = {}, options: { route?: Route } = {}) {
  const calls = createFetch(override)
  const events = createEventSource()
  let sync!: ReturnType<typeof useSync>
  let project!: ReturnType<typeof useProject>
  let kv!: ReturnType<typeof useKV>
  let permission!: ReturnType<typeof usePermission>
  let route!: ReturnType<typeof useRoute>
  let toast!: ReturnType<typeof useToast>
  let done!: () => void
  const ready = new Promise<void>((resolve) => {
    done = resolve
  })

  function Probe() {
    const ctx: Ctx = {
      kv: useKV(),
      permission: usePermission(),
      project: useProject(),
      route: useRoute(),
      sync: useSync(),
      toast: useToast(),
    }
    onMount(() => {
      sync = ctx.sync
      project = ctx.project
      kv = ctx.kv
      permission = ctx.permission
      route = ctx.route
      toast = ctx.toast
      done()
    })
    return <box />
  }

  const app = await testRender(() => (
    <TestTuiContexts paths={state ? { state } : undefined}>
      <ArgsProvider {...args}>
        <KVProvider>
          <ToastProvider>
            <RouteProvider initialRoute={options.route}>
              <SDKProvider url="http://test" directory={directory} fetch={calls.fetch} events={events.source}>
                <PermissionProvider>
                  <ProjectProvider>
                    <ExitProvider exit={() => {}}>
                      <SyncProvider>
                        <Probe />
                      </SyncProvider>
                    </ExitProvider>
                  </ProjectProvider>
                </PermissionProvider>
              </SDKProvider>
            </RouteProvider>
          </ToastProvider>
        </KVProvider>
      </ArgsProvider>
    </TestTuiContexts>
  ))

  await ready
  await wait(() => sync.status === "complete")
  return { app, emit: events.emit, kv, permission, project, route, sync, toast, session: calls.session }
}
