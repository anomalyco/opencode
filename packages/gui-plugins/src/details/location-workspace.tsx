import { Icon } from "@opencode/ui/icon"
import { Menu } from "@opencode/ui/menu"
import { Show } from "solid-js"
import type { BuiltinSlotMap } from "@opencode/plugin/gui/builtin"
import { SessionWorkspaceMenu } from "./workspace-menu"

export default function SessionLocationWorkspace(props: BuiltinSlotMap["session.location.workspace"]) {
  const location = () => (
    <>
      <Icon name={props.icon} class="text-v2-icon-icon-muted" />
      <bdi dir="auto" class="min-w-0 truncate">
        {props.label}
      </bdi>
    </>
  )

  return (
    <Show when={props.session.project}>
      {(project) => (
        <Show
          when={!props.session.server.data.session.get(props.session.id)?.parentID}
          fallback={<Menu.Item disabled>{location()}</Menu.Item>}
        >
          <SessionWorkspaceMenu sub session={props.session} project={project()} directory={props.session.directory}>
            {location()}
          </SessionWorkspaceMenu>
        </Show>
      )}
    </Show>
  )
}
