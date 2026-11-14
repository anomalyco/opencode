import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { onMount } from "solid-js"
import type { IntegrationInfo } from "@opencode/client/promise"
import type { ServerConnection } from "@/runtime/server/registry"
import { DialogStoryRuntime, STORY_DIRECTORY, STORY_LOCKED_SERVER } from "@/components-lab/dialog-story-runtime"
import { DialogConnectProvider, useProviderConnectController } from "./dialog"

function ConnectProviderDialogStory() {
  const dialog = useDialog()

  const open = () => void dialog.show(() => <DialogConnectProvider directory={STORY_DIRECTORY} />)

  onMount(open)

  return (
    <Button variant="neutral" onClick={open}>
      Open connect integration dialog
    </Button>
  )
}

function ProviderConnectionDialogStory(props: { provider: string }) {
  const dialog = useDialog()

  const controller = useProviderConnectController()

  const open = () => {
    controller.select(props.provider)
    void dialog.show(() => <DialogConnectProvider directory={STORY_DIRECTORY} controller={controller} />)
  }

  onMount(open)

  return (
    <Button variant="neutral" onClick={open}>
      Open {props.provider} connection dialog
    </Button>
  )
}

function renderConnection(
  provider: string,
  options: { integrations?: IntegrationInfo[]; servers?: ServerConnection.Any[] } = {},
) {
  return () => {
    return (
      <DialogStoryRuntime integrations={options.integrations} servers={options.servers}>
        <ProviderConnectionDialogStory provider={provider} />
      </DialogStoryRuntime>
    )
  }
}

const REMOTE_SERVER: ServerConnection.Http = {
  type: "http",
  displayName: "Dev box",
  http: { url: "http://devbox.local:4096" },
}

const claudeWithProblem = (message: string): IntegrationInfo[] => [
  {
    id: "claude-agent",
    name: "Claude Agent",
    methods: [{ type: "external", id: "claude-login", label: "Claude Code login (claude auth login)" }],
    connections: [
      {
        type: "credential",
        id: "cred_claude",
        label: "Claude Code",
        method: "external",
        status: { status: "needs_auth", message, url: "https://code.claude.com/docs/en/setup" },
      },
    ],
  },
]

export default {
  title: "App/Dialogs/Connect Provider",
  id: "app-dialog-connect-provider",
}

export const Picker = {
  render: () => (
    <DialogStoryRuntime>
      <ConnectProviderDialogStory />
    </DialogStoryRuntime>
  ),
}

export const ChooseMethod = {
  render: renderConnection("opencode"),
}

/** OpenCode Console through a remote server: pick "API key (service account)" to see the note on a form. */
export const ConsoleRemote = { render: renderConnection("opencode", { servers: [REMOTE_SERVER] }) }

// Console with only its browser sign-in, so the story starts on the device code.
const consoleAccountOnly: IntegrationInfo[] = [
  {
    id: "opencode",
    name: "OpenCode Console",
    methods: [{ type: "oauth", id: "console", label: "OpenCode Console account" }],
    connections: [],
  },
]

export const ConsoleSignIn = { render: renderConnection("opencode", { integrations: consoleAccountOnly }) }

export const ApiKey = {
  render: renderConnection("openrouter"),
}

export const LoginMethods = {
  render: renderConnection("openai"),
}

export const ClaudeAgentSetup = { render: renderConnection("claude-agent") }

export const ClaudeAgentNotInstalled = {
  render: renderConnection("claude-agent", {
    integrations: claudeWithProblem("Claude Code is not installed. Install it, then run `claude auth login`."),
  }),
}

export const ClaudeAgentNotSignedIn = {
  render: renderConnection("claude-agent", {
    integrations: claudeWithProblem("Claude Code is not logged in. Run `claude auth login` in a terminal."),
  }),
}

/** A device sign-in with a confirmation code. */
export const AwaitingBrowser = { render: renderConnection("github-copilot") }

/** A choice between a device sign-in and an API key. */
export const DeviceOrApiKey = { render: renderConnection("xai") }

// OpenAI with only its ChatGPT method, so the story opens straight on the sign-in.
const chatgptOnly: IntegrationInfo[] = [
  {
    id: "openai",
    name: "OpenAI",
    methods: [{ type: "oauth", id: "chatgpt", label: "ChatGPT Plus / Pro" }],
    connections: [],
  },
]

/** A browser sign-in that also takes a pasted redirect URL. */
export const RedirectPaste = { render: renderConnection("openai", { integrations: chatgptOnly }) }

/** The same sign-in through a remote server, where the paste field starts open. */
export const RedirectPasteRemote = {
  render: renderConnection("openai", { integrations: chatgptOnly, servers: [REMOTE_SERVER] }),
}

/** A text question before the sign-in, then a browser sign-in with redirect paste. */
export const TextQuestion = { render: renderConnection("gitlab") }

/** A required text question. Continue with an empty field to see the error. */
export const RequiredTextQuestion = { render: renderConnection("snowflake-cortex") }

/** Pick "AWS profile": a choice question with a custom answer, for an external credential. */
export const ChoiceQuestion = { render: renderConnection("amazon-bedrock") }

/** A multiselect question with a custom item, then a yes/no question, then the API key. */
export const MultiselectQuestion = { render: renderConnection("acme-search") }

/** A link the user opens and confirms before the sign-in. */
export const ExternalLinkQuestion = { render: renderConnection("acme-cloud") }

/** A sign-in that runs a command and shows its output. */
export const Command = { render: renderConnection("acme-cli") }

/** A sign-in that asks for the authorization code the browser shows. */
export const PasteCode = { render: renderConnection("acme-code") }

/** A sign-in the server fails to start. */
export const Failed = { render: renderConnection("acme-broken") }

// The fixture refuses requests to this server. Submitting a sample service key shows the real error and retry.
export const LockedRemoteServer = {
  render: () => (
    <DialogStoryRuntime servers={[STORY_LOCKED_SERVER]}>
      <ProviderConnectionDialogStory provider="opencode" />
    </DialogStoryRuntime>
  ),
}
