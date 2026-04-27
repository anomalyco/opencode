import type { APIEvent } from "@solidjs/start/server"
import { getHandler, optionsHandler } from "../../util/modelsHandler"

export async function OPTIONS(_input: APIEvent) {
  return optionsHandler()
}

export async function GET(input: APIEvent) {
  return getHandler({ modelList: "lite" })
}
