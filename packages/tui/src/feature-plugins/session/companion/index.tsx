import { Plugin } from "@opencode/plugin/tui"
import { createEffect, createResource, createRoot, createSignal, Show } from "solid-js"
import { Spinner } from "../../../component/spinner"
import { useConfig } from "../../../config"
import { Keymap } from "../../../context/keymap"
import { useTheme } from "../../../context/theme"
import { errorMessage } from "../../../util/error"
import { CompanionPanel } from "./panel"
import { createVoice, sentences, speakable } from "./voice"

const PANEL = "companion"

export default Plugin.define({
  id: "opencode.companion",
  setup(context) {
    const companions = new Map<string, Promise<string>>()
    const toastError = (error: unknown) => context.ui.toast.show({ variant: "error", message: errorMessage(error) })
    // Assistant messages to read aloud: every reply after a spoken prompt, until the user types or talks over it.
    const [follow, setFollow] = createSignal<{ sessionID: string; known: ReadonlySet<string> }>()
    const spoken = new Map<string, number>()
    const [talking, setTalking] = createSignal<string>()
    const [bargeIn, setBargeIn] = createSignal(false)

    // One lookup per main session, so the panel and the talk key cannot race to create two companions.
    const lookup = (sessionID: string) => {
      const cached = companions.get(sessionID)
      if (cached) return cached
      const request = context.client.session.companion({ sessionID }).then((info) => info.id)
      request.catch(() => companions.delete(sessionID))
      companions.set(sessionID, request)
      return request
    }
    // Session retention evicts the companion's messages with its main session, so every use syncs again.
    const companionOf = (sessionID: string) =>
      lookup(sessionID).then(async (companionID) => {
        await Promise.all([context.data.session.sync(companionID), context.data.session.message.sync(companionID)])
        return companionID
      })

    const send = (sessionID: string, text: string, voice: boolean) => {
      const known = new Set(
        context.data.session.message
          .list(sessionID)
          .flatMap((message) => (message.type === "assistant" ? [message.id] : [])),
      )
      setFollow(voice ? { sessionID, known } : undefined)
      void context.client.session
        .prompt({ sessionID, text, ...(voice ? { metadata: { voice: true } } : {}) })
        .catch(toastError)
    }

    const voice = createVoice({
      client: context.client,
      bargeIn,
      onTranscript: (text, interrupting) => {
        const sessionID = talking()
        if (!sessionID) return
        if (!interrupting) return send(sessionID, text, true)
        // A prompt admitted before the interrupt would be stranded in the stopped reply's inbox.
        void stop(sessionID).then(() => send(sessionID, text, true))
      },
      onError: toastError,
    })

    const stop = (sessionID: string | undefined) => {
      setFollow(undefined)
      voice.stop()
      if (!sessionID || context.data.session.status(sessionID) !== "running") return Promise.resolve()
      return context.client.session.interrupt({ sessionID }).then(() => undefined, toastError)
    }

    const current = () => {
      const route = context.ui.router.current()
      if (route.type === "session") return route.sessionID
      context.ui.toast.show({ message: "Open a session first", variant: "warning" })
    }

    const toggle = () => {
      if (context.ui.panel.current()?.name === PANEL) return context.ui.panel.close()
      if (!current()) return
      context.ui.panel.open(PANEL)
    }

    const talk = async () => {
      const sessionID = current()
      if (!sessionID) return
      if (context.ui.panel.current()?.name !== PANEL) context.ui.panel.open(PANEL)
      const companionID = await companionOf(sessionID).catch((error) => {
        toastError(error)
        return undefined
      })
      if (!companionID) return
      // Talking over the companion stops its reply so the new utterance takes the turn.
      if (voice.state.status === "idle" || voice.state.status === "speaking") void stop(companionID)
      setTalking(companionID)
      voice.toggle()
    }

    const dispose = createRoot((dispose) => {
      createEffect(() => {
        const target = follow()
        if (!target) return
        context.data.session.message.list(target.sessionID).forEach((message) => {
          if (message.type !== "assistant" || target.known.has(message.id)) return
          const text = speakable(
            message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n\n"),
          )
          const next = sentences(text, spoken.get(message.id) ?? 0, message.time.completed !== undefined)
          spoken.set(message.id, next.end)
          next.chunks.forEach(voice.speak)
        })
      })
      return dispose
    })

    context.ui.slot({
      append: "session.panel",
      render: (input) => {
        const [companion] = createResource(
          () => (input.name === PANEL ? input.sessionID : undefined),
          (sessionID) => companionOf(sessionID),
        )
        return (
          <Show when={input.name === PANEL}>
            <CompanionPanel
              input={input}
              companionID={companion()}
              error={companion.error ? errorMessage(companion.error) : undefined}
              voice={voice}
              onSubmit={(text) => {
                voice.stop()
                // The companion may still be loading when the first message is typed.
                void companionOf(input.sessionID).then((companionID) => send(companionID, text, false), toastError)
              }}
              onStop={() => void stop(companion())}
            />
          </Show>
        )
      },
    })

    context.ui.slot({
      append: "prompt.footer.status",
      render: () => {
        const theme = useTheme()
        return (
          <Show when={voice.state.status !== "idle"}>
            <box flexShrink={0}>
              <Spinner color={theme.text.feedback.info.base}>{voice.state.status}</Spinner>
            </box>
          </Show>
        )
      },
    })

    context.ui.slot({
      append: "app",
      render() {
        const config = useConfig()
        const enabled = () => config.data.experimental?.companion === true
        createEffect(() => setBargeIn(enabled() && config.data.experimental?.companion_barge_in === true))
        Keymap.createLayer(() => ({
          mode: "global",
          enabled,
          commands: [
            {
              id: "session.companion",
              title: "Talk with the companion",
              description: "Open a persistent side conversation that can observe and steer this session",
              group: "Session",
              palette: true,
              slash: { name: "companion" },
              run: toggle,
            },
            {
              id: "companion.talk",
              title: "Talk to the companion by voice",
              description: "Start listening, or send what you said",
              group: "Session",
              palette: true,
              run: () => void talk(),
            },
          ],
        }))
        return null
      },
    })

    return () => {
      dispose()
      voice.stop()
    }
  },
})
