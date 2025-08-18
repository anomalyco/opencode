import { Button } from "../../ui/button"
import { IconArrowRight } from "../../ui/svg/icons"
import { createSignal, For } from "solid-js"
import { createToolCaller } from "./components/tool"
import { useApi } from "../components/context-api"
import { useWorkspace } from "../components/context-workspace"
import style from "./index.module.css"

export default function Index() {
  const api = useApi()
  const workspace = useWorkspace()

  return (
    <div class={style.root}>
      <h1>Hello</h1>
    </div>
  )
}
