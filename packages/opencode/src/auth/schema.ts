import z from "zod"

export const Oauth = z
  .object({
    type: z.literal("oauth"),
    refresh: z.string(),
    access: z.string(),
    expires: z.number(),
    accountId: z.string().optional(),
    enterpriseUrl: z.string().optional(),
  })
  .catchall(z.unknown())
  .meta({ ref: "OAuth" })

export const Api = z
  .object({
    type: z.literal("api"),
    key: z.string(),
  })
  .meta({ ref: "ApiAuth" })

export const WellKnown = z
  .object({
    type: z.literal("wellknown"),
    key: z.string(),
    token: z.string(),
  })
  .meta({ ref: "WellKnownAuth" })

export const Info = z.discriminatedUnion("type", [Oauth, Api, WellKnown]).meta({ ref: "Auth" })

export type Oauth = z.infer<typeof Oauth>
export type Api = z.infer<typeof Api>
export type WellKnown = z.infer<typeof WellKnown>
export type Info = z.infer<typeof Info>
