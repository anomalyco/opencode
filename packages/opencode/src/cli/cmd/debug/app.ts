import { App } from "../../../app/app"
import { bootstrap } from "../../bootstrap"
import { cmd } from "../cmd"

const AppInfoCommand = cmd({
  command: "info",
  builder: (yargs) => yargs,
  async handler() {
    await bootstrap({ cwd: process.cwd() }, async () => {
      const app = App.info()
      console.log(JSON.stringify(app, null, 2))
    })
  },
})

export const AppCommand = cmd({
  command: "app",
  builder: (yargs) => yargs.command(AppInfoCommand).demandCommand(),
  async handler() {},
})
