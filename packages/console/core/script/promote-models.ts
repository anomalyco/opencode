#!/usr/bin/env bun

import { $ } from "bun"
import path from "path"
import os from "os"
import { ZenData } from "../src/model"

const stage = process.argv[2]
if (!stage) throw new Error("Stage is required")

const root = path.resolve(process.cwd(), "..", "..", "..")
const PARTS = 10

// read the secret
const ret = await $`bun sst secret list`.cwd(root).text()
const lines = ret.split("\n")
const values = Array.from({ length: PARTS }, (_, i) => {
  const value = lines
    .find((line) => line.startsWith(`ZEN_MODELS${i + 1}=`))
    ?.split("=")
    .slice(1)
    .join("=")
  if (!value) throw new Error(`ZEN_MODELS${i + 1} not found`)
  return value
})

// validate value
ZenData.validate(JSON.parse(values.join("")))

// update the secret
const envFile = Bun.file(path.join(os.tmpdir(), `models-${Date.now()}.env`))
await envFile.write(values.map((v, i) => `ZEN_MODELS${i + 1}=${v}`).join("\n"))
await $`bun sst secret load ${envFile.name} --stage ${stage}`.cwd(root)
