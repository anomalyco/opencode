#!/usr/bin/env bun

import { $ } from "bun"
import path from "path"
import { ZenData } from "../src/model"

const stage = process.argv[2]
if (!stage) throw new Error("Stage is required")

const root = path.resolve(process.cwd(), "..", "..", "..")

// read the secret
const ret = await $`bun sst secret list`.cwd(root).text()
const value1 = ret
  .split("\n")
  .find((line) => line.startsWith("ZEN_MODELS1"))
  ?.split("=")[1]
const value2 = ret
  .split("\n")
  .find((line) => line.startsWith("ZEN_MODELS2"))
  ?.split("=")[1]
if (!value1) throw new Error("ZEN_MODELS1 not found")
if (!value2) throw new Error("ZEN_MODELS2 not found")

// validate value
ZenData.validate(JSON.parse(value1 + value2))

// update the secret
await $`bun sst secret set ZEN_MODELS1 ${value1} --stage ${stage}`
await $`bun sst secret set ZEN_MODELS2 ${value2} --stage ${stage}`
