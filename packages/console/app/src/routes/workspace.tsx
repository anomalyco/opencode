import { query, createAsync, RouteSectionProps, useParams, A } from "@solidjs/router"
import "./workspace.css"
import { IconWorkspaceLogo } from "../component/icon"
import { WorkspacePicker } from "./workspace-picker"
import { UserMenu } from "./user-menu"
import { withActor } from "~/context/auth.withActor"
import { User } from "@opencode-ai/console-core/user.js"
import { Actor } from "@opencode-ai/console-core/actor.js"

const getUserEmail = query(async (workspaceID: string) => {
  "use server"
  return withActor(async () => {
    const actor = Actor.assert("user")
    const email = await User.getAuthEmail(actor.properties.userID)
    return email
  }, workspaceID)
}, "userEmail")

export default function WorkspaceLayout(props: RouteSectionProps) {
  const params = useParams()
  const userEmail = createAsync(() => getUserEmail(params.id!))
  return (
    <main data-page="workspace">
      <header data-component="workspace-header">
        <div data-slot="header-brand">
          <A href="/" data-component="site-title">
            <IconWorkspaceLogo />
          </A>
          <WorkspacePicker />
        </div>
        <div data-slot="header-actions">
          <UserMenu email={userEmail()} />
        </div>
      </header>
      <div>{props.children}</div>
    </main>
  )
}
