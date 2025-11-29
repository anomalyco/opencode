#!/usr/bin/env bun

import { $ } from "bun"
import path from "path"
import os from "os"
import { ZenData } from "../src/model"

const root = path.resolve(process.cwd(), "..", "..", "..")
const models = await $`bun sst secret list`.cwd(root).text()

// read the line starting with "ZEN_MODELS"
const lines = models.split("\n")
const oldValue1 = lines.find((line) => line.startsWith("ZEN_MODELS1"))?.split("=")[1]
const oldValue2 = lines.find((line) => line.startsWith("ZEN_MODELS2"))?.split("=")[1]
const oldValue3 = lines.find((line) => line.startsWith("ZEN_MODELS3"))?.split("=")[1]
const oldValue4 = lines.find((line) => line.startsWith("ZEN_MODELS4"))?.split("=")[1]
if (!oldValue1) throw new Error("ZEN_MODELS1 not found")
if (!oldValue2) throw new Error("ZEN_MODELS2 not found")
if (!oldValue3) throw new Error("ZEN_MODELS3 not found")
if (!oldValue4) throw new Error("ZEN_MODELS4 not found")

// store the prettified json to a temp file
const filename = `models-${Date.now()}.json`
const tempFile = Bun.file(path.join(os.tmpdir(), filename))
await tempFile.write(JSON.stringify(JSON.parse(oldValue1 + oldValue2 + oldValue3 + oldValue4), null, 2))
console.log("tempFile", tempFile.name)

// open temp file in vim and read the file on close
await $`vim ${tempFile.name}`
const newValue = JSON.stringify(JSON.parse(await tempFile.text()))
ZenData.validate(JSON.parse(newValue))

// update the secret
const chunk = Math.ceil(newValue.length / 4)
const newValue1 = newValue.slice(0, chunk)
const newValue2 = newValue.slice(chunk, chunk * 2)
const newValue3 = newValue.slice(chunk * 2, chunk * 3)
const newValue4 = newValue.slice(chunk * 3)
await $`bun sst secret set ZEN_MODELS1 ${newValue1}`
await $`bun sst secret set ZEN_MODELS2 ${newValue2}`
await $`bun sst secret set ZEN_MODELS3 ${newValue3}`
await $`bun sst secret set ZEN_MODELS4 ${newValue4}`
