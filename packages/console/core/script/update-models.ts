#!/usr/bin/env bun

import { $ } from "bun"
import path from "path"
import os from "os"
import { ZenData } from "../src/model"

const root = path.resolve(process.cwd(), "..", "..", "..")
const models = await $`bun sst secret list`.cwd(root).text()
console.log("models", models)

// read the line starting with "ZEN_MODELS"
const oldValue = models
  .split("\n")
  .find((line) => line.startsWith("ZEN_MODELS"))
  ?.split("=")[1]
if (!oldValue) throw new Error("ZEN_MODELS not found")
console.log("oldValue", oldValue)

// store the prettified json to a temp file
const filename = `models-${Date.now()}.json`
const tempFile = Bun.file(path.join(os.tmpdir(), filename))
await tempFile.write(JSON.stringify(JSON.parse(oldValue), null, 2))
console.log("tempFile", tempFile.name)

// open temp file in vim and read the file on close
await $`vim ${tempFile.name}`
const newValue = JSON.parse(await tempFile.text())
ZenData.validate(newValue)

// update the secret
await $`bun sst secret set ZEN_MODELS ${JSON.stringify(newValue)}`
