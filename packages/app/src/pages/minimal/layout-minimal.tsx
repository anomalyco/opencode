import { createResource, Show, type ParentProps } from "solid-js"
import { useNavigate, useParams } from "@solidjs/router"
import { Toast } from "@opencode-ai/ui/toast"
import { base64Encode } from "@opencode-ai/util/encode"
import { useLayout } from "@/context/layout"
import { useServer } from "@/context/server"
import { decode64 } from "@/utils/base64"

export default function LayoutMinimal(props: ParentProps) {
  const params = useParams()
  const navigate = useNavigate()
  const layout = useLayout()
  const server = useServer()

  const initialDirectory = decode64(params.dir)

  const [autoselecting] = createResource(async () => {
    await layout.ready.promise
    if (initialDirectory) return

    const list = layout.projects.list()
    const last = server.projects.last()

    const next = list.length === 0 ? last : (list.find((p) => p.worktree === last)?.worktree ?? list[0]?.worktree)
    if (!next) return

    layout.projects.open(next)
    navigate(`/${base64Encode(next)}/session`, { replace: true })
  })

  return (
    <div class="h-dvh w-screen overflow-hidden bg-background-base">
      <Show when={!autoselecting.loading} fallback={<div class="size-full" />}>
        {props.children}
      </Show>
      <Toast.Region />
    </div>
  )
}
