/** @jsxImportSource @opentui/solid */
import { testRender } from "@opentui/solid"
import { onMount } from "solid-js"
import { ArgsProvider } from "../../../../src/context/args"
import { ProjectProvider, useProject } from "../../../../src/context/project"
import { SDKProvider } from "../../../../src/context/sdk"
import { SyncProvider, useSync } from "../../../../src/context/sync"
import { PermissionProvider } from "../../../../src/context/permission"
import { ExitProvider } from "../../../../src/context/exit"
import { createApi, createClient, createEventStream, createFetch, type FetchHandler } from "../../../fixture/tui-sdk"
import { TestTuiContexts } from "../../../fixture/tui-environment"
export { createEventStream, createFetch, directory, json, worktree } from "../../../fixture/tui-sdk"

export async function wait(fn: () => boolean, timeout = 2000) {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting for condition")
    await Bun.sleep(10)
  }
}

type Ctx = { project: ReturnType<typeof useProject>; sync: ReturnType<typeof useSync> }

export async function mount(override?: FetchHandler, state?: string) {
  const events = createEventStream()
  const calls = createFetch(override, events)
  let sync!: ReturnType<typeof useSync>
  let project!: ReturnType<typeof useProject>
  let done!: () => void
  const ready = new Promise<void>((resolve) => {
    done = resolve
  })

  function Probe() {
    const ctx: Ctx = { project: useProject(), sync: useSync() }
    onMount(() => {
      sync = ctx.sync
      project = ctx.project
      done()
    })
    return <box />
  }

  const app = await testRender(() => (
    <TestTuiContexts paths={state ? { state } : undefined}>
      <ArgsProvider>
        <SDKProvider client={createClient(calls.fetch)} api={createApi(calls.fetch)}>
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
      </ArgsProvider>
    </TestTuiContexts>
  ))

  await ready
  await wait(() => sync.status === "complete")
  return { app, emit: events.emit, project, sync, session: calls.session }
}
