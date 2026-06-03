import * as Effect from "effect/Effect"
import { Api } from "../api"
import { CliBuilder } from "../cli-builder"

export default CliBuilder.handler(Api.commands.migrate, (_input) => Effect.log("No migrations to run."))
