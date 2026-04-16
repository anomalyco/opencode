import { HttpApi, OpenApi } from "effect/unstable/httpapi"
import { questionApi } from "./question.js"

export const api = HttpApi.make("opencode")
  .addHttpApi(questionApi)
  .annotateMerge(
    OpenApi.annotations({
      title: "opencode experimental HttpApi",
      version: "0.0.1",
      description: "Experimental HttpApi surface for selected instance routes.",
    }),
  )
