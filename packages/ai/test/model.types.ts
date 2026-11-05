import type { Model } from "../src/effect.js"
import { OpenAI } from "../src/providers.js"

declare const model: Model

if (model.type === "chat") model.baseURL satisfies string | undefined
if (model.type === "image") {
  // @ts-expect-error Only text models carry a baseURL.
  void model.baseURL
}

const chat = OpenAI.configure({ apiKey: "fixture" }).chat("gpt-5.5")
;({ ...chat, baseURL: "https://proxy.test/v1" }) satisfies Model<"chat">
;({ ...chat, options: { ...chat.options, temperature: 0 } }) satisfies Model<"chat">
const image = OpenAI.configure({ apiKey: "fixture" }).image("gpt-image-2")
// @ts-expect-error Image models have no baseURL to edit.
;({ ...image, baseURL: "https://proxy.test/v1" }) satisfies Model<"image">
