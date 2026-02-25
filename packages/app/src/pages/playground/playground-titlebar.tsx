import { createMemo } from "solid-js"
import { useLocation, useNavigate, useParams } from "@solidjs/router"
import { Portal } from "solid-js/web"
import { Tabs } from "@opencode-ai/ui/tabs"

export function PlaygroundTitlebar() {
  const params = useParams()
  const navigate = useNavigate()
  const location = useLocation()

  const value = createMemo(() => {
    if (location.pathname.includes("/playground")) return "playground"
    return "code"
  })

  function onChange(val: string) {
    if (!params.dir) return
    if (val === "playground") {
      navigate(`/${params.dir}/playground`)
    } else {
      navigate(`/${params.dir}/session`)
    }
  }

  const mount = createMemo(() => document.getElementById("opencode-titlebar-center"))

  return (
    <>
      {mount() && (
        <Portal mount={mount()!}>
          <Tabs variant="pill" value={value()} onChange={onChange}>
            <Tabs.List>
              <Tabs.Trigger value="code">Code</Tabs.Trigger>
              <Tabs.Trigger value="playground">Playground</Tabs.Trigger>
            </Tabs.List>
          </Tabs>
        </Portal>
      )}
    </>
  )
}
