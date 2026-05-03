export { initVeritlyTracer, type InitVeritlyTracerOptions } from "./init.js"
export {
  resolveOtlpTracesUrl,
  resolveOtlpLogsUrl,
  otlpTraceExporterOptions,
  otlpLogsExporterOptions,
  sanitizeOtlpUrlForDiag,
  mergeOtlpHeaders,
} from "./otlp.js"
export { isOtlpExportDebugEnabled } from "./otlp-export-diag.js"
export { veritlyHonoOtelMiddleware } from "./hono.js"
export { injectTraceHeaders } from "./propagate.js"
export {
  deploymentInfoFlat,
  railwayDeploymentFlat,
  veritlyOtelResourceAttributes,
  railwayOtelResourceAttributes,
} from "./deployment.js"
