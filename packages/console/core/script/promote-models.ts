#!/usr/bin/env bun

import { $ } from "bun"
import path from "path"
import { ZenData } from "../src/model"

const stage = process.argv[2]
if (!stage) throw new Error("Stage is required")

const root = path.resolve(process.cwd(), "..", "..", "..")

// read the secret
const ret = await $`bun sst secret list`.cwd(root).text()
const value = ret
  .split("\n")
  .find((line) => line.startsWith("ZEN_MODELS"))
  ?.split("=")[1]
if (!value) throw new Error("ZEN_MODELS not found")

// validate value
ZenData.validate(JSON.parse(value))

// update the secret
await $`bun sst secret set ZEN_MODELS ${value} --stage ${stage}`
