#!/usr/bin/env bun

import { $ } from "bun"
import path from "path"
import { ZenData } from "../src/model"

const stage = process.argv[2]
if (!stage) throw new Error("Stage is required")

const root = path.resolve(process.cwd(), "..", "..", "..")

// read the secret
const ret = await $`bun sst secret list --stage ${stage}`.cwd(root).text()
const lines = ret.split("\n")
const value1 = lines.find((line) => line.startsWith("ZEN_MODELS1"))?.split("=")[1]
const value2 = lines.find((line) => line.startsWith("ZEN_MODELS2"))?.split("=")[1]
const value3 = lines.find((line) => line.startsWith("ZEN_MODELS3"))?.split("=")[1]
const value4 = lines.find((line) => line.startsWith("ZEN_MODELS4"))?.split("=")[1]
if (!value1) throw new Error("ZEN_MODELS1 not found")
if (!value2) throw new Error("ZEN_MODELS2 not found")
if (!value3) throw new Error("ZEN_MODELS3 not found")
if (!value4) throw new Error("ZEN_MODELS4 not found")

// validate value
ZenData.validate(JSON.parse(value1 + value2 + value3 + value4))

// update the secret
await $`bun sst secret set ZEN_MODELS1 ${value1}`
await $`bun sst secret set ZEN_MODELS2 ${value2}`
await $`bun sst secret set ZEN_MODELS3 ${value3}`
await $`bun sst secret set ZEN_MODELS4 ${value4}`
