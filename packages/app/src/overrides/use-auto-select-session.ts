import { createEffect } from "solid-js"
import { useNavigate, useParams } from "@solidjs/router"
import { useSync } from "@/context/sync"
import { resolveLatestSessionPath } from "./use-auto-select-session-helpers"

export function useAutoSelectSession() {
  const params = useParams()
  const navigate = useNavigate()
  const sync = useSync()

  createEffect(() => {
    const path = resolveLatestSessionPath(params.id, params.dir, sync.data.session)
    if (path) navigate(path, { replace: true })
  })
}
