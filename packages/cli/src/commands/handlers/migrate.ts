import { Effect } from "effect"
import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"

export default Runtime.handler(Commands.commands.migrate, (_input) => Effect.log("No migrations to run."))
