import z from "zod"

export const ConfigModelID = z.string().meta({ $ref: "https://models.dev/model-schema.json#/$defs/Model" })
