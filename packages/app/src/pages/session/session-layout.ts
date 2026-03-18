import { useParams } from "@solidjs/router"
import { useSessionParams } from "@/hooks/use-session-params"
import { createMemo } from "solid-js"
import { useLayout } from "@/context/layout"

export const useSessionKey = () => {
  const params = useSessionParams()
  const sessionKey = createMemo(() => `${params.dir}${params.id ? "/" + params.id : ""}`)
  return { params, sessionKey }
}

export const useSessionLayout = () => {
  const layout = useLayout()
  const { params, sessionKey } = useSessionKey()
  return {
    params,
    sessionKey,
    tabs: createMemo(() => layout.tabs(sessionKey)),
    view: createMemo(() => layout.view(sessionKey)),
  }
}
