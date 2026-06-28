import { Argument, Flag } from "effect/unstable/cli"
import { Spec } from "../framework/spec"

declare const OPENCODE_CLI_NAME: string | undefined

export const Commands = Spec.make(typeof OPENCODE_CLI_NAME === "string" ? OPENCODE_CLI_NAME : "opencode", {
  description: "OpenCode 2.0 preview command line interface",
  commands: [
    Spec.make("api", {
      description: "Make a request to the running server",
      params: {
        request: Argument.string("operation | method path").pipe(
          Argument.withDescription("OpenAPI operation ID, or an HTTP method followed by a path"),
          Argument.variadic({ min: 1, max: 2 }),
        ),
        data: Flag.string("data").pipe(Flag.withAlias("d"), Flag.withDescription("Request body"), Flag.optional),
        header: Flag.string("header").pipe(
          Flag.withAlias("H"),
          Flag.withDescription("Request header in name:value form"),
          Flag.atMost(100),
        ),
        param: Flag.keyValuePair("param").pipe(Flag.withDescription("OpenAPI path or query parameter"), Flag.optional),
      },
    }),
    Spec.make("debug", {
      description: "Debugging and troubleshooting tools",
      commands: [Spec.make("agents", { description: "List all agents" })],
    }),
    Spec.make("migrate", { description: "Migrate v1 data to v2" }),
    Spec.make("service", {
      description: "Manage the background server",
      commands: [
        Spec.make("start", { description: "Start the background server" }),
        Spec.make("restart", { description: "Restart the background server" }),
        Spec.make("status", { description: "Show background server status" }),
        Spec.make("stop", { description: "Stop the background server" }),
        Spec.make("password", {
          description: "Get or set the server password",
          params: { value: Argument.string("value").pipe(Argument.optional) },
        }),
      ],
    }),
    Spec.make("serve", {
      description: "Start the v2 API server",
      params: {
        hostname: Flag.string("hostname").pipe(Flag.withDefault("127.0.0.1")),
        port: Flag.integer("port").pipe(Flag.optional),
        register: Flag.boolean("register").pipe(Flag.withDefault(false)),
      },
    }),
    Spec.make("task", {
      description: "Manage background tasks",
      commands: [
        Spec.make("start", {
          description: "Start a background task",
          params: {
            name: Flag.string("name").pipe(Flag.withDescription("Task name")),
            command: Argument.string("command").pipe(Argument.withDescription("Shell command to run")),
            cwd: Flag.string("cwd").pipe(Flag.withDescription("Working directory"), Flag.optional),
            port: Flag.integer("port").pipe(Flag.withDescription("Optional listening port"), Flag.optional),
          },
        }),
        Spec.make("stop", {
          description: "Stop a background task",
          params: {
            taskId: Argument.string("taskId").pipe(Argument.withDescription("Task ID")),
          },
        }),
        Spec.make("restart", {
          description: "Restart a background task",
          params: {
            taskId: Argument.string("taskId").pipe(Argument.withDescription("Task ID")),
          },
        }),
        Spec.make("kill", {
          description: "Force kill a background task",
          params: {
            taskId: Argument.string("taskId").pipe(Argument.withDescription("Task ID")),
          },
        }),
        Spec.make("list", {
          description: "List all background tasks",
        }),
        Spec.make("logs", {
          description: "Show logs for a background task",
          params: {
            taskId: Argument.string("taskId").pipe(Argument.withDescription("Task ID")),
            lines: Flag.integer("lines").pipe(Flag.withDescription("Number of lines to read"), Flag.optional),
            follow: Flag.boolean("follow").pipe(Flag.withAlias("f"), Flag.withDescription("Follow log stream"), Flag.withDefault(false)),
          },
        }),
        Spec.make("delete", {
          description: "Delete a background task's record and logs",
          params: {
            taskId: Argument.string("taskId").pipe(Argument.withDescription("Task ID")),
          },
        }),
      ],
    }),
  ],
})
