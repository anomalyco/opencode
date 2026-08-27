import type { Argv } from "yargs"
import { Effect } from "effect"
import path from "path"
import { Global } from "@opencode-ai/core/global"
import { effectCmd, fail } from "../effect-cmd"

export const SetTelegramTokenCommand = effectCmd({
  command: "set-tg-token <token>",
  describe: "save a Telegram bot token for the telegram bridge",
  instance: false,
  builder: (yargs: Argv) => {
    return yargs.positional("token", {
      type: "string",
      demandOption: true,
      describe: "bot token from @BotFather",
    })
  },
  handler: Effect.fn("Cli.setTelegramToken")(function* (args: { token: string }) {
    const token = args.token.trim()
    if (!token) return yield* fail("Bot token is required")
    const tokenPath = path.join(Global.Path.data, "telegram-token")
    yield* Effect.promise(async () => {
      await Bun.write(tokenPath, token, { createPath: true })
      await import("fs/promises").then((fs) => fs.chmod(tokenPath, 0o600)).catch(() => {})
    }).pipe(Effect.catch((error) => fail(String(error))))
    console.log("Telegram bot token saved. Run `opencode telegram` or use `/telegram` in TUI to start the bridge.")
  }),
})
