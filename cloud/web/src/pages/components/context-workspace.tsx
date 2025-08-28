import { useNavigate, useParams } from "@solidjs/router"
import { createInitializedContext } from "../../util/context"
import { useAccount } from "../../components/context-account"
import { createEffect, createMemo } from "solid-js"

export const { use: useWorkspace, provider: WorkspaceProvider } =
  createInitializedContext("WorkspaceProvider", () => {
    const params = useParams()
    const account = useAccount()
    const workspace = createMemo(() =>
      account.current?.workspaces.find(
        (x) => x.id === params.workspace || x.slug === params.workspace,
      ),
    )
    const nav = useNavigate()

    createEffect(() => {
      if (!workspace()) nav("/")
    })

    const result = () => workspace()!
    result.ready = true

    return {
      get id() {
        return workspace()!.id
      },
      get slug() {
        return workspace()!.slug
      },
      get name() {
        return workspace()!.name
      },
      get ready() {
        return workspace() !== undefined
      },
    }
  })
