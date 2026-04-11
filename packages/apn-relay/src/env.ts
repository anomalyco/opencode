import { z } from "zod"

const bad = new Set(["undefined", "null"])
const txt = z
  .string()
  .transform((input) => input.trim())
  .refine((input) => input.length > 0 && !bad.has(input.toLowerCase()))

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(8787),
  DATABASE_HOST: txt,
  DATABASE_USERNAME: txt,
  DATABASE_PASSWORD: txt,
  APNS_TEAM_ID: txt,
  APNS_KEY_ID: txt,
  APNS_PRIVATE_KEY: txt,
  APNS_DEFAULT_BUNDLE_ID: txt,
})

const req = [
  "DATABASE_HOST",
  "DATABASE_USERNAME",
  "DATABASE_PASSWORD",
  "APNS_TEAM_ID",
  "APNS_KEY_ID",
  "APNS_PRIVATE_KEY",
  "APNS_DEFAULT_BUNDLE_ID",
] as const

const out = schema.safeParse(process.env)

if (!out.success) {
  const miss = req.filter((key) => !process.env[key]?.trim())
  const bad = out.error.issues
    .map((item) => item.path[0])
    .filter((key): key is string => typeof key === "string")
    .filter((key) => !miss.includes(key as (typeof req)[number]))

  console.error("[apn-relay] Invalid startup configuration")
  if (miss.length) console.error(`[apn-relay] Missing required env vars: ${miss.join(", ")}`)
  if (bad.length) console.error(`[apn-relay] Invalid env vars: ${Array.from(new Set(bad)).join(", ")}`)
  console.error("[apn-relay] Check .env.example and restart")

  throw new Error("Startup configuration invalid")
}

export const env = out.data
