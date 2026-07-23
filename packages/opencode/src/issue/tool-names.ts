/**
 * Linear MCP tool names discovered via StreamableHTTP probe.
 *
 * Source: discovered via mcp-remote on 2026-06-20
 * Method: StreamableHTTPClientTransport to https://mcp.linear.app/mcp
 * Total: 39 tools across 8 categories
 */

export const ISSUE = {
  GET: "get_issue",
  LIST: "list_issues",
  SAVE: "save_issue",
  LIST_STATUSES: "list_issue_statuses",
  GET_STATUS: "get_issue_status",
  LIST_LABELS: "list_issue_labels",
  CREATE_LABEL: "create_issue_label",
} as const

export const COMMENT = {
  LIST: "list_comments",
  SAVE: "save_comment",
  DELETE: "delete_comment",
} as const

export const USER = {
  GET: "get_user",
  LIST: "list_users",
} as const

export const TEAM = {
  GET: "get_team",
  LIST: "list_teams",
} as const

export const PROJECT = {
  GET: "get_project",
  LIST: "list_projects",
  SAVE: "save_project",
  LIST_LABELS: "list_project_labels",
} as const

export const CYCLE = {
  LIST: "list_cycles",
} as const

export const DOCUMENT = {
  GET: "get_document",
  LIST: "list_documents",
  SAVE: "save_document",
} as const

export const ATTACHMENT = {
  GET: "get_attachment",
  CREATE: "create_attachment",
  PREPARE_UPLOAD: "prepare_attachment_upload",
  CREATE_FROM_UPLOAD: "create_attachment_from_upload",
  DELETE: "delete_attachment",
} as const

export const MILESTONE = {
  GET: "get_milestone",
  LIST: "list_milestones",
  SAVE: "save_milestone",
} as const

export const DIFF = {
  GET: "get_diff",
  LIST: "list_diffs",
  GET_THREADS: "get_diff_threads",
} as const

export const STATUS_UPDATE = {
  GET: "get_status_updates",
  SAVE: "save_status_update",
  DELETE: "delete_status_update",
} as const

export const IMAGE = {
  EXTRACT: "extract_images",
} as const

export const DOCS = {
  SEARCH: "search_documentation",
} as const

/** All Linear MCP tool names as a flat record */
export const LINEAR_TOOL_NAMES = {
  ...ISSUE,
  ...COMMENT,
  ...USER,
  ...TEAM,
  ...PROJECT,
  ...CYCLE,
  ...DOCUMENT,
  ...ATTACHMENT,
  ...MILESTONE,
  ...DIFF,
  ...STATUS_UPDATE,
  ...IMAGE,
  ...DOCS,
} as const

export type LinearToolName = (typeof LINEAR_TOOL_NAMES)[keyof typeof LINEAR_TOOL_NAMES]
