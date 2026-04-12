import { context, propagation } from "@opentelemetry/api"

const setter = {
  set(carrier: Record<string, string>, key: string, value: string) {
    carrier[key] = value
  },
}

export function injectTraceHeaders(carrier: Record<string, string>): void {
  propagation.inject(context.active(), carrier, setter)
}
