import { Plugin } from "@opencode/plugin/tui"

// Claims the transcript's chrome: a header, a first row, the user prompt and
// the turn footer, with tight rows, a one-cell inset and a band composer.
export default Plugin.define({
  id: "fixture.transcript-chrome",
  setup(context) {
    context.ui.layout({
      inset: 1,
      rowGap: (row) => (row.kind === "footer" ? 0 : 1),
      composer: { chrome: "band", prefix: "> " },
    })
    context.ui.slot({ append: "session.header", render: () => <text>Header claimed</text> })
    context.ui.slot({ append: "session.transcript.start", render: () => <text>Transcript start claimed</text> })
    context.ui.slot({
      replace: "session.message.user",
      render: (input) => {
        const text = () => {
          const message = context.data.session.message.get(input.sessionID, input.messageID)
          return message?.type === "user" ? message.text : ""
        }
        return <text>User band: {text()}</text>
      },
    })
    context.ui.slot({
      replace: "session.message.assistant.footer",
      render: (input) => <text>Footer for {input.messageID}</text>,
    })
  },
})
