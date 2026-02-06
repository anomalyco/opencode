#!/usr/bin/env bun

import { $ } from "bun"
import path from "path"
import os from "os"
import { ZenData } from "../src/model"

const OPENROUTER_PROVIDER_DEFAULTS = {
  api: "https://openrouter.ai/api/v1",
  apiKey: "REPLACE_ME",
  format: "oa-compat",
  headers: {
    "HTTP-Referer": "https://opencode.ai/",
    "X-Title": "opencode",
  },
}

const OPENROUTER_FREE_MODELS = [
  "openrouter/free",
  "deepseek/deepseek-r1-0528:free",
  "qwen/qwen3-coder:free",
  "google/gemma-3-12b-it:free",
  "meta-llama/llama-3.3-70b-instruct:free",
] as const

function applyOpenRouterPatch(input: any) {
  if (!input || typeof input !== "object") return input

  input.providers ??= {}
  const provider = input.providers.openrouter ?? {}
  input.providers.openrouter = {
    ...OPENROUTER_PROVIDER_DEFAULTS,
    ...provider,
    headers: {
      ...OPENROUTER_PROVIDER_DEFAULTS.headers,
      ...(provider.headers ?? {}),
    },
  }

  input.models ??= {}
  for (const modelId of OPENROUTER_FREE_MODELS) {
    if (input.models[modelId]) continue
    input.models[modelId] = {
      name: modelId,
      cost: { input: 0, output: 0 },
      byokProvider: "openrouter",
      providers: [
        {
          id: "openrouter",
          model: modelId,
        },
      ],
    }
  }

  return input
}

const root = path.resolve(process.cwd(), "..", "..", "..")
const models = await $`bun sst secret list`.cwd(root).text()
const PARTS = 10

// read the line starting with "ZEN_MODELS"
const lines = models.split("\n")
const oldValues = Array.from({ length: PARTS }, (_, i) => {
  const value = lines
    .find((line) => line.startsWith(`ZEN_MODELS${i + 1}=`))
    ?.split("=")
    .slice(1)
    .join("=")
  // TODO
  //if (!value) throw new Error(`ZEN_MODELS${i + 1} not found`)
  //return value
  return value ?? ""
})

// store the prettified json to a temp file
const filename = `models-${Date.now()}.json`
const tempFile = Bun.file(path.join(os.tmpdir(), filename))
await tempFile.write(JSON.stringify(JSON.parse(oldValues.join("")), null, 2))
console.log("tempFile", tempFile.name)

// open temp file in vim and read the file on close
await $`vim ${tempFile.name}`
const parsed = JSON.parse(await tempFile.text())
const patched = applyOpenRouterPatch(parsed)
ZenData.validate(patched)
const newValue = JSON.stringify(patched)

// update the secret
const chunk = Math.ceil(newValue.length / PARTS)
const newValues = Array.from({ length: PARTS }, (_, i) =>
  newValue.slice(chunk * i, i === PARTS - 1 ? undefined : chunk * (i + 1)),
)

const envFile = Bun.file(path.join(os.tmpdir(), `models-${Date.now()}.env`))
await envFile.write(newValues.map((v, i) => `ZEN_MODELS${i + 1}=${v}`).join("\n"))
await $`bun sst secret load ${envFile.name}`.cwd(root)
