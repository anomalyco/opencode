import { expect, test } from "bun:test"
import { Document, Info } from "../config.js"
import { Model } from "../model.js"
import { ConfigPreset } from "./preset.js"

test("layered preset targets inherit when omitted and clear when explicitly self-targeted", () => {
  const entry = (models: NonNullable<NonNullable<Info["providers"]>[string]["models"]>) =>
    new Document({ type: "document", info: new Info({ providers: { p: { models } } }) })
  const first = entry({ alias: { modelID: Model.ID.make("base") }, twin: { modelID: Model.ID.make("base") } })
  const second = entry({ alias: { name: "Renamed" }, twin: { modelID: Model.ID.make("twin") } })
  expect([...ConfigPreset.models([first, second])]).toEqual(["p:alias"])
  expect([...ConfigPreset.models([second, first])]).toEqual(["p:alias", "p:twin"])
})
