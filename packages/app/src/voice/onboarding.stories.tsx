import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { VoiceOnboardingDialog, type VoiceAccess, type VoiceMicrophone } from "./onboarding"

export default {
  title: "OpenCode/Voice/Onboarding",
  id: "voice-onboarding",
  parameters: {
    docs: {
      description: {
        component:
          "The first time someone presses the call button: what a call does, whether this server can place one, and how to connect GPT-Live when it can't. Start, Connect and Add key only act on the story.",
      },
    },
  },
}

function OnboardingStory(props: { access: VoiceAccess; microphone: VoiceMicrophone }) {
  const dialog = useDialog()
  const [story, setStory] = createStore({ access: props.access, note: "" })

  const open = () =>
    dialog.show(() => (
      <VoiceOnboardingDialog
        access={story.access}
        microphone={props.microphone}
        onStart={() => {
          dialog.close()
          setStory("note", "Call started")
        }}
        // Connecting comes back ready, as the real screen does once the connect dialog closes.
        onConnect={(provider) => {
          setStory("access", { type: "checking" })
          setTimeout(
            () => setStory("access", { type: "ready", via: provider === "opencode" ? "console" : "openai" }),
            900,
          )
        }}
        onRetry={() => {
          setStory("access", { type: "checking" })
          setTimeout(() => setStory("access", props.access), 900)
        }}
      />
    ))

  onMount(open)

  return (
    <div class="flex flex-col items-center gap-2">
      <Button variant="neutral" onClick={open}>
        Open voice onboarding
      </Button>
      <output class="text-12-regular text-v2-text-text-faint">{story.note}</output>
    </div>
  )
}

export const FirstCall = {
  name: "Ready through OpenCode Console",
  render: () => <OnboardingStory access={{ type: "ready", via: "console" }} microphone="prompt" />,
}

export const OpenAIKey = {
  name: "Ready with an OpenAI key",
  render: () => <OnboardingStory access={{ type: "ready", via: "openai" }} microphone="granted" />,
}

export const NotSetUp = {
  name: "GPT-Live not set up",
  render: () => <OnboardingStory access={{ type: "missing" }} microphone="prompt" />,
}

export const Checking = {
  name: "Checking the server",
  render: () => <OnboardingStory access={{ type: "checking" }} microphone="prompt" />,
}

export const MicrophoneBlocked = {
  name: "Microphone blocked",
  render: () => <OnboardingStory access={{ type: "ready", via: "console" }} microphone="denied" />,
}

export const Unreachable = {
  name: "Server unreachable",
  render: () => <OnboardingStory access={{ type: "unreachable" }} microphone="prompt" />,
}
