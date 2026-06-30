import { Argument, Flag } from "effect/unstable/cli"
import { Spec } from "../framework/spec"

declare const OPENCODE_CLI_NAME: string | undefined

export const Commands = Spec.make(typeof OPENCODE_CLI_NAME === "string" ? OPENCODE_CLI_NAME : "opencode", {
  description: "OpenCode 2.0 preview command line interface",
  params: {
    directory: Argument.string("directory").pipe(
      Argument.withDescription("Directory to start OpenCode in"),
      Argument.optional,
    ),
    standalone: Flag.boolean("standalone").pipe(
      Flag.withDescription("Run with a private server instead of the background service"),
      Flag.withDefault(false),
    ),
  },
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
        Spec.make("get", {
          description: "Get service configuration",
          params: { key: Argument.string("key").pipe(Argument.optional) },
        }),
        Spec.make("set", {
          description: "Set service configuration",
          params: { key: Argument.string("key"), value: Argument.string("value") },
        }),
        Spec.make("unset", {
          description: "Unset service configuration",
          params: { key: Argument.string("key") },
        }),
      ],
    }),
    Spec.make("serve", {
      description: "Start the v2 API server",
      params: {
        hostname: Flag.string("hostname").pipe(Flag.optional),
        port: Flag.integer("port").pipe(Flag.optional),
        service: Flag.boolean("service").pipe(Flag.withDefault(false)),
        stdio: Flag.boolean("stdio").pipe(Flag.withDefault(false)),
      },
    }),
  ],
})
