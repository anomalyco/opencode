import { request } from "./client"

export type AuditLog = {
  event: string
  data?: Record<string, unknown>
}

export async function log(input: AuditLog) {
  return request<unknown>({ path: "/v1/audit/log", method: "POST", body: input })
}
