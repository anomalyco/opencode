/**
 * Cloud Auto-Switch Component
 *
 * Automatically restores workspace routing when navigating to cloud workspaces.
 * This handles the case where a user navigates directly to a session URL
 * that requires connection to a cloud sandbox.
 */

import { createEffect, type ParentProps } from "solid-js"
import { useParams } from "@solidjs/router"
import { useServer } from "@/context/server"
import { base64Decode } from "@opencode-ai/util/encode"
import { validWorktree } from "@claxedo/utils/worktree"

export interface CloudAutoSwitchProps extends ParentProps {}

/**
 * CloudAutoSwitch component.
 * Monitors navigation and automatically connects to cloud sandbox servers
 * when navigating to cloud session URLs.
 *
 * Uses useServer() internally - must be rendered inside ServerProvider.
 */
export function CloudAutoSwitch(props: CloudAutoSwitchProps) {
  const server = useServer()
  const params = useParams()

  const directory = () => {
    const encoded = params.dir
    if (!encoded) return
    try {
      const decoded = base64Decode(encoded)
      if (!validWorktree(decoded)) return
      return decoded
    } catch {
      return
    }
  }

  createEffect(() => {
    const current = server.url
    if (/^https?:\/\/[^/]+\/(w|s)\//.test(current)) {
      const origin = current.split("/").slice(0, 3).join("/")
      if (origin) server.setActive(origin)
      return
    }
    // Touch directory so the gateway can start relaying events for it.
    directory()
  })

  return <>{props.children}</>
}

/**
 * Create CloudAutoSwitch as a ParentComponent for use as an authenticated provider.
 */
export function createCloudAutoSwitchProvider() {
  return (props: ParentProps) => (
    <CloudAutoSwitch>
      {props.children}
    </CloudAutoSwitch>
  )
}
