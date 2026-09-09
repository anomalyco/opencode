import { Plugin } from "@opencode/plugin/desktop"
import { Tabs } from "@opencode/ui/tabs"
import { createTerminalRuntime, TerminalProvider } from "./context"
import { TerminalPanel } from "./panel"

export const TerminalDesktop = Plugin.define({
  id: "opencode.terminal",
  name: "terminal.title",
  setup(ctx) {
    const runtime = createTerminalRuntime(ctx)
    ctx.commands.register(() => {
      const session = ctx.sessions.current()
      const services = session?.services
      if (!session || !services) return []
      const terminal = runtime.workspace(session.server, services.files.directory)
      const dock = services.view.auxiliary
      return [
        {
          id: "toggle",
          reference: "terminal.toggle",
          title: ctx.i18n.t("command.terminal.toggle"),
          group: ctx.i18n.t("command.category.view"),
          bind: "ctrl+`",
          slash: "terminal",
          run() {
            if (dock.opened()) {
              terminal.cancelFocus()
              dock.close()
              return
            }
            dock.open()
            terminal.requestFocus(terminal.active())
          },
        },
        {
          id: "new",
          reference: "terminal.new",
          title: ctx.i18n.t("command.terminal.new"),
          description: ctx.i18n.t("command.terminal.new.description"),
          group: ctx.i18n.t("command.category.terminal"),
          bind: "ctrl+alt+t",
          run() {
            dock.open()
            if (terminal.all().length > 0) terminal.new()
            if (terminal.all().length === 0) terminal.requestFocus()
          },
        },
        {
          id: "close",
          reference: "terminal.close",
          title: ctx.i18n.t("terminal.close"),
          group: ctx.i18n.t("command.category.terminal"),
          bind: "mod+w",
          palette: false,
          when: (event: KeyboardEvent) =>
            event.target instanceof Element && !!event.target.closest('[data-component="terminal"]'),
          run() {
            const id = terminal.active()
            if (!id) return
            const last = terminal.all().length === 1
            void terminal.close(id)
            if (last) dock.close()
          },
        },
      ]
    })
    ctx.ui.slot({
      append: "session.auxiliary",
      render: (input) => (
        <TerminalProvider runtime={runtime} input={input}>
          <TerminalPanel {...input.presentation} />
        </TerminalProvider>
      ),
    })
    ctx.ui.slot({
      append: "session.mobile.actions",
      render: ({ session }) => (
        <Tabs.Trigger value="auxiliary" onClick={() => session.services?.view.auxiliary.open()}>
          {ctx.i18n.t("terminal.title")}
        </Tabs.Trigger>
      ),
    })
  },
})
