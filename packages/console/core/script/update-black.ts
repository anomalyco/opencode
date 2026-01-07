#!/usr/bin/env bun

import { $ } from "bun"
import path from "path"
import os from "os"
import { BlackData } from "../src/black"

const root = path.resolve(process.cwd(), "..", "..", "..")
const secrets = await $`bun sst secret list`.cwd(root).text()

// read the line starting with "ZEN_BLACK"
const lines = secrets.split("\n")
const oldValue = lines.find((line) => line.startsWith("ZEN_BLACK"))?.split("=")[1]
if (!oldValue) throw new Error("ZEN_BLACK not found")

// store the prettified json to a temp file
const filename = `black-${Date.now()}.json`
const tempFile = Bun.file(path.join(os.tmpdir(), filename))
await tempFile.write(JSON.stringify(JSON.parse(oldValue), null, 2))
console.log("tempFile", tempFile.name)

// open temp file in vim and read the file on close
await $`vim ${tempFile.name}`
const newValue = JSON.stringify(JSON.parse(await tempFile.text()))
BlackData.validate(JSON.parse(newValue))

// update the secret
await $`bun sst secret set ZEN_BLACK ${newValue}`
