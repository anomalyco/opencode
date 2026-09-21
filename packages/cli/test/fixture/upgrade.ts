import { NodeServices } from "@effect/platform-node"
import { Effect } from "effect"
import { Command } from "effect/unstable/cli"
import { Commands } from "../../src/commands/commands"
import upgrade from "../../src/commands/handlers/upgrade"
import { Updater } from "../../src/services/updater"

const record = (event: unknown) => console.log(`EVENT ${JSON.stringify(event)}`)

await Effect.runPromise(
  Command.runWith(Commands.commands.upgrade.spec.pipe(Command.withHandler(upgrade)), { version: "test" })(
    process.argv.slice(2),
  ).pipe(
    Effect.provideService(Updater.Service, {
      run: () => Effect.die("Manual upgrades must not check for automatic updates"),
      check: () => Effect.die("Manual upgrades must not check for TUI updates"),
      apply: () => Effect.die("Manual upgrades must not apply TUI updates"),
      removal: () => undefined,
      method: () =>
        Effect.sync(() => {
          record("method")
          return Updater.methods.find((method) => method === (process.env.UPGRADE_TEST_METHOD ?? "npm"))
        }),
      latest: () =>
        Effect.suspend(() => {
          record("latest")
          return process.env.UPGRADE_TEST_LATEST_ERROR
            ? Effect.fail(
                new Updater.UpgradeError({
                  title: "Could not check for OpenCode updates",
                  detail: "The update service returned HTTP 503.",
                  retry: "Try again in a few minutes.",
                }),
              )
            : Effect.succeed("0.0.0-beta-new")
        }),
      upgrade: (method, version) =>
        Effect.suspend(() => {
          record({ method, version })
          return process.env.UPGRADE_TEST_INSTALL_ERROR
            ? Effect.fail(
                new Updater.UpgradeError({
                  title: "npm could not install OpenCode",
                  detail: "Permission denied",
                  command: "npm install @opencode/cli@0.0.0-beta-new",
                  retry: "Fix the issue above, then run opencode upgrade again.",
                }),
              )
            : Effect.void
        }),
    }),
    Effect.provide(NodeServices.layer),
  ),
)
