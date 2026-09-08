import { Show, createEffect } from "solid-js"
import { Plugin } from "@opencode/plugin/desktop"
import { Panel } from "@opencode/plugin/desktop/solid"
import { SessionContextTab } from "./panel"
import { SessionContextUsage } from "./button"
import { toggleContext } from "./toggle"

export const ContextDesktop = Plugin.define({
  id: "opencode.context",
  setup(ctx) {
    ctx.commands.register(() => {
      const session = ctx.sessions.current()
      return [
        {
          id: "toggle",
          title: ctx.i18n.t("context.usage.view"),
          enabled: !!session?.services,
          run() {
            if (session) toggleContext(session)
          },
        },
      ]
    })
    ctx.ui.slot({
      append: "session.header.actions",
      render: ({ session }) => <SessionContextUsage session={session} placement="bottom" />,
    })
    ctx.ui.slot({
      append: "session.panel",
      render: ({ session }) => {
        createEffect(() => {
          if (!session.services) return
          void session.server.data.location.model.sync(session.location)
          void session.server.data.location.provider.sync(session.location)
        })
        return (
          <Show when={session.services}>
            {(services) => (
              <Panel
                id="context"
                reference="context"
                initial="closed"
                title={ctx.i18n.t(services().view.desktop() ? "session.tab.context" : "session.tab.usage")}
                icon={<SessionContextUsage session={session} variant="indicator" />}
              >
                <SessionContextTab session={session} view={services().view} />
              </Panel>
            )}
          </Show>
        )
      },
    })
  },
})
