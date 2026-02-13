/**
 * Session Params Context
 *
 * Provides session parameters (sessionId, directory, groupId) to components
 * that need to render a session without relying on URL routing.
 *
 * In split mode, each group panel provides its own SessionParamsContext,
 * allowing multiple sessions to render simultaneously.
 *
 * Components check for this context first, falling back to useParams() for
 * backward compatibility with the URL-driven single-session flow.
 */

import { createSimpleContext } from "@opencode-ai/ui/context"
import type { Accessor } from "solid-js"

export const { use: useSessionParams, provider: SessionParamsProvider } = createSimpleContext({
  name: "SessionParams",
  init: (props: {
    sessionId: Accessor<string | undefined>
    directory: Accessor<string>
    groupId: Accessor<string>
  }) => ({
    sessionId: props.sessionId,
    directory: props.directory,
    groupId: props.groupId,
  }),
})
