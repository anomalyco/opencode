import { Show } from "solid-js"

export function SessionTabAvatar(props: {
  project?: { worktree: string }
  directory: string
  sessionId: string
  server: string
}) {
  const initial = () => {
    const name = props.project?.worktree?.split("/").pop() ?? props.directory.split("/").pop() ?? "?"
    return name.charAt(0).toUpperCase()
  }
  return (
    <span class="flex size-4 shrink-0 items-center justify-center rounded-[3px] bg-v2-icon-icon-accent/20 text-[9px] font-medium text-v2-icon-icon-accent">
      {initial()}
    </span>
  )
}
