import { WorkspaceProvider } from "./components/context-workspace"
import { ParentProps } from "solid-js"
import Layout from "./components/layout"

export default function Index(props: ParentProps) {
  return (
    <WorkspaceProvider>
      <Layout>{props.children}</Layout>
    </WorkspaceProvider>
  )
}
