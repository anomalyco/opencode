export type Runtime = {
  PublicApi: (typeof import("../../../src/server/routes/instance/httpapi/public"))["PublicApi"]
  ExperimentalHttpApiServer: (typeof import("../../../src/server/routes/instance/httpapi/server"))["ExperimentalHttpApiServer"]
  Server: (typeof import("../../../src/server/server"))["Server"]
  AppLayer: (typeof import("../../../src/effect/app-runtime"))["AppLayer"]
  InstanceRef: (typeof import("../../../src/effect/instance-ref"))["InstanceRef"]
  Instance: (typeof import("../../../src/project/instance"))["Instance"]
  InstanceStore: (typeof import("../../../src/project/instance-store"))["InstanceStore"]
  Session: (typeof import("../../../src/session/session"))["Session"]
  Todo: (typeof import("../../../src/session/todo"))["Todo"]
  Worktree: (typeof import("../../../src/worktree"))["Worktree"]
  Project: (typeof import("../../../src/project/project"))["Project"]
  Tui: typeof import("../../../src/server/shared/tui-control")
  disposeAllInstances: (typeof import("../../fixture/fixture"))["disposeAllInstances"]
  tmpdir: (typeof import("../../fixture/fixture"))["tmpdir"]
  resetDatabase: (typeof import("../../fixture/db"))["resetDatabase"]
}

let runtimePromise: Promise<Runtime> | undefined

export function runtime() {
  return (runtimePromise ??= (async () => {
    const publicApi = await import("../../../src/server/routes/instance/httpapi/public")
    const httpApiServer = await import("../../../src/server/routes/instance/httpapi/server")
    const server = await import("../../../src/server/server")
    const appRuntime = await import("../../../src/effect/app-runtime")
    const instanceRef = await import("../../../src/effect/instance-ref")
    const instance = await import("../../../src/project/instance")
    const instanceStore = await import("../../../src/project/instance-store")
    const session = await import("../../../src/session/session")
    const todo = await import("../../../src/session/todo")
    const worktree = await import("../../../src/worktree")
    const project = await import("../../../src/project/project")
    const tui = await import("../../../src/server/shared/tui-control")
    const fixture = await import("../../fixture/fixture")
    const db = await import("../../fixture/db")
    return {
      PublicApi: publicApi.PublicApi,
      ExperimentalHttpApiServer: httpApiServer.ExperimentalHttpApiServer,
      Server: server.Server,
      AppLayer: appRuntime.AppLayer,
      InstanceRef: instanceRef.InstanceRef,
      Instance: instance.Instance,
      InstanceStore: instanceStore.InstanceStore,
      Session: session.Session,
      Todo: todo.Todo,
      Worktree: worktree.Worktree,
      Project: project.Project,
      Tui: tui,
      disposeAllInstances: fixture.disposeAllInstances,
      tmpdir: fixture.tmpdir,
      resetDatabase: db.resetDatabase,
    }
  })())
}
