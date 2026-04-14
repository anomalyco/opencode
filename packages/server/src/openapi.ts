import { api } from "./definition/api.js"
import type { OpenApiSpec } from "./types.js"

export function openapi(): OpenApiSpec {
  return {
    openapi: "3.1.1",
    info: {
      title: api.name,
      version: "0.0.0",
      description: "Contract-first server package scaffold.",
    },
    paths: {},
  }
}
