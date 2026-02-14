import {
  HEADER_ORGANIZATIONID,
  HEADER_TASKID,
  HEADER_PROJECTID,
  HEADER_TESTER,
  HEADER_EDITORNAME,
  USER_AGENT,
  CONTENT_TYPE,
  DEFAULT_EDITOR_NAME,
  ENV_EDITOR_NAME,
  TESTER_SUPPRESS_VALUE,
} from "./api/constants.js"

/**
 * Header constants for KiloCode API requests
 * @deprecated Use HEADER_* constants from constants.ts instead
 */
export const X_KILOCODE_ORGANIZATIONID = HEADER_ORGANIZATIONID
export const X_KILOCODE_TASKID = HEADER_TASKID
export const X_KILOCODE_PROJECTID = HEADER_PROJECTID
export const X_KILOCODE_TESTER = HEADER_TESTER
export const X_KILOCODE_EDITORNAME = HEADER_EDITORNAME

/**
 * Default headers for KiloCode requests
 */
export const DEFAULT_HEADERS = {
  "User-Agent": USER_AGENT,
  "Content-Type": CONTENT_TYPE,
}

/**
 * Get editor name header value
 * Defaults to "opencode" but can be customized
 */
export function getEditorNameHeader(): string {
  return process.env[ENV_EDITOR_NAME] ?? DEFAULT_EDITOR_NAME
}

/**
 * Build KiloCode-specific headers from metadata and options
 */
export function buildKiloHeaders(
  metadata?: { taskId?: string; projectId?: string },
  options?: {
    kilocodeOrganizationId?: string
    kilocodeTesterWarningsDisabledUntil?: number
  },
): Record<string, string> {
  const headers: Record<string, string> = {
    [X_KILOCODE_EDITORNAME]: getEditorNameHeader(),
  }

  if (metadata?.taskId) {
    headers[X_KILOCODE_TASKID] = metadata.taskId
  }

  if (options?.kilocodeOrganizationId) {
    headers[X_KILOCODE_ORGANIZATIONID] = options.kilocodeOrganizationId

    if (metadata?.projectId) {
      headers[X_KILOCODE_PROJECTID] = metadata.projectId
    }
  }

  // Add X-KILOCODE-TESTER: SUPPRESS header if the setting is enabled
  if (options?.kilocodeTesterWarningsDisabledUntil && options.kilocodeTesterWarningsDisabledUntil > Date.now()) {
    headers[X_KILOCODE_TESTER] = TESTER_SUPPRESS_VALUE
  }

  return headers
}
