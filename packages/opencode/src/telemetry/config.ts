import { z } from "zod"

export namespace TelemetryConfig {
  export const ObjectSchema = z.object({
    enabled: z.boolean().default(false),
    serviceName: z.string().default("opencode"),
    endpoint: z.string().optional(),
    protocol: z.enum(["http", "grpc"]).default("http"),
    headers: z.record(z.string(), z.string()).optional(),
    exportInterval: z.number().default(5000),
    maxQueueSize: z.number().default(2048),
    recordInputs: z.boolean().default(true),
    recordOutputs: z.boolean().default(true),
    sampleRate: z.number().min(0).max(1).default(1.0),
    attributes: z.record(z.string(), z.any()).optional(),
  })

  export type ObjectInfo = z.output<typeof ObjectSchema>

  export type Info = ObjectInfo | undefined

  export function normalize(val: boolean | ObjectInfo | undefined): ObjectInfo {
    if (val === undefined) return { enabled: false, serviceName: "opencode", protocol: "http", exportInterval: 5000, maxQueueSize: 2048, recordInputs: true, recordOutputs: true, sampleRate: 1.0 }
    if (typeof val === "boolean") return { enabled: val, serviceName: "opencode", protocol: "http", exportInterval: 5000, maxQueueSize: 2048, recordInputs: true, recordOutputs: true, sampleRate: 1.0 }
    return val
  }

  export function fromEnv(): Partial<ObjectInfo> {
    const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT
    const serviceName = process.env.OTEL_SERVICE_NAME

    const result: Partial<ObjectInfo> = {}
    if (endpoint) result.endpoint = endpoint
    if (serviceName) result.serviceName = serviceName

    return result
  }

  export function merge(config: ObjectInfo, env: Partial<ObjectInfo>): ObjectInfo {
    return {
      ...config,
      ...env,
    }
  }

  export const defaults: ObjectInfo = {
    enabled: false,
    serviceName: "opencode",
    protocol: "http",
    exportInterval: 5000,
    maxQueueSize: 2048,
    recordInputs: true,
    recordOutputs: true,
    sampleRate: 1.0,
  }
}
