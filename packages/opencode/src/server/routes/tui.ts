import { Hono } from "hono"
import { describeRoute, validator } from "hono-openapi"
import { resolver } from "hono-openapi"
import z from "zod"
import { Bus } from "../../bus"
import { TuiEvent } from "@/cli/cmd/tui/event"
import { errors } from "./shared"

export function tuiRoutes() {
  const router = new Hono()

  router
    .post(
      "/append-prompt",
      describeRoute({
        description: "Append prompt to the TUI",
        operationId: "tui.appendPrompt",
        responses: {
          200: {
            description: "Prompt processed successfully",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", TuiEvent.PromptAppend.properties),
      async (c) => {
        await Bus.publish(TuiEvent.PromptAppend, c.req.valid("json"))
        return c.json(true)
      },
    )
    .post(
      "/open-help",
      describeRoute({
        description: "Open the help dialog",
        operationId: "tui.openHelp",
        responses: {
          200: {
            description: "Help dialog opened successfully",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(true)
      },
    )
    .post(
      "/open-sessions",
      describeRoute({
        description: "Open the session dialog",
        operationId: "tui.openSessions",
        responses: {
          200: {
            description: "Session dialog opened successfully",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
        },
      }),
      async (c) => {
        await Bus.publish(TuiEvent.CommandExecute, {
          command: "session.list",
        })
        return c.json(true)
      },
    )
    .post(
      "/open-themes",
      describeRoute({
        description: "Open the theme dialog",
        operationId: "tui.openThemes",
        responses: {
          200: {
            description: "Theme dialog opened successfully",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
        },
      }),
      async (c) => {
        await Bus.publish(TuiEvent.CommandExecute, {
          command: "session.list",
        })
        return c.json(true)
      },
    )
    .post(
      "/open-models",
      describeRoute({
        description: "Open the model dialog",
        operationId: "tui.openModels",
        responses: {
          200: {
            description: "Model dialog opened successfully",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
        },
      }),
      async (c) => {
        await Bus.publish(TuiEvent.CommandExecute, {
          command: "model.list",
        })
        return c.json(true)
      },
    )
    .post(
      "/submit-prompt",
      describeRoute({
        description: "Submit the prompt",
        operationId: "tui.submitPrompt",
        responses: {
          200: {
            description: "Prompt submitted successfully",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
        },
      }),
      async (c) => {
        await Bus.publish(TuiEvent.CommandExecute, {
          command: "prompt.submit",
        })
        return c.json(true)
      },
    )
    .post(
      "/clear-prompt",
      describeRoute({
        description: "Clear the prompt",
        operationId: "tui.clearPrompt",
        responses: {
          200: {
            description: "Prompt cleared successfully",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
        },
      }),
      async (c) => {
        await Bus.publish(TuiEvent.CommandExecute, {
          command: "prompt.clear",
        })
        return c.json(true)
      },
    )
    .post(
      "/execute-command",
      describeRoute({
        description: "Execute a TUI command (e.g. agent_cycle)",
        operationId: "tui.executeCommand",
        responses: {
          200: {
            description: "Command executed successfully",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", z.object({ command: z.string() })),
      async (c) => {
        const command = c.req.valid("json").command
        await Bus.publish(TuiEvent.CommandExecute, {
          // @ts-expect-error
          command: {
            session_new: "session.new",
            session_share: "session.share",
            session_interrupt: "session.interrupt",
            session_compact: "session.compact",
            messages_page_up: "session.page.up",
            messages_page_down: "session.page.down",
            messages_half_page_up: "session.half.page.up",
            messages_half_page_down: "session.half.page.down",
            messages_first: "session.first",
            messages_last: "session.last",
            agent_cycle: "agent.cycle",
          }[command],
        })
        return c.json(true)
      },
    )
    .post(
      "/show-toast",
      describeRoute({
        description: "Show a toast notification in the TUI",
        operationId: "tui.showToast",
        responses: {
          200: {
            description: "Toast notification shown successfully",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
        },
      }),
      validator("json", TuiEvent.ToastShow.properties),
      async (c) => {
        await Bus.publish(TuiEvent.ToastShow, c.req.valid("json"))
        return c.json(true)
      },
    )
    .post(
      "/publish",
      describeRoute({
        description: "Publish a TUI event",
        operationId: "tui.publish",
        responses: {
          200: {
            description: "Event published successfully",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "json",
        z.union(
          Object.values(TuiEvent).map((def) => {
            return z
              .object({
                type: z.literal(def.type),
                properties: def.properties,
              })
              .meta({
                ref: "Event" + "." + def.type,
              })
          }),
        ),
      ),
      async (c) => {
        const evt = c.req.valid("json")
        await Bus.publish(Object.values(TuiEvent).find((def) => def.type === evt.type)!, evt.properties)
        return c.json(true)
      },
    )

  return router
}
