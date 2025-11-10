#!/usr/bin/env bun

import { $ } from "bun"
import path from "path"
import os from "os"
import { ZenData } from "../src/model"

const root = path.resolve(process.cwd(), "..", "..", "..")
const models = await $`bun sst secret list`.cwd(root).text()

// read the line starting with "ZEN_MODELS"
const oldValue1 = models
  .split("\n")
  .find((line) => line.startsWith("ZEN_MODELS1"))
  ?.split("=")[1]
const oldValue2 = models
  .split("\n")
  .find((line) => line.startsWith("ZEN_MODELS2"))
  ?.split("=")[1]
if (!oldValue1) throw new Error("ZEN_MODELS1 not found")
if (!oldValue2) throw new Error("ZEN_MODELS2 not found")

// store the prettified json to a temp file
const filename = `models-${Date.now()}.json`
const tempFile = Bun.file(path.join(os.tmpdir(), filename))
await tempFile.write(JSON.stringify(JSON.parse(oldValue1 + oldValue2), null, 2))
console.log("tempFile", tempFile.name)

// open temp file in vim and read the file on close
await $`vim ${tempFile.name}`
const newValue = JSON.stringify(JSON.parse(await tempFile.text()))
ZenData.validate(JSON.parse(newValue))

// update the secret
const mid = Math.floor(newValue.length / 2)
await $`bun sst secret set ZEN_MODELS1 ${newValue.slice(0, mid)}`
await $`bun sst secret set ZEN_MODELS2 ${newValue.slice(mid)}`
