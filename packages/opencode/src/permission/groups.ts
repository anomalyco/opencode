import { EDIT_TOOL_IDS } from "@/tool/edit/contract"

const edit = [...EDIT_TOOL_IDS].filter((item) => item !== "edit")

export const agentPermissionGroups = {
  map: ["inspect", "search"],
  read: ["inspect", "search", "discover_batch"],
  edit: [...edit, "workspace_replace", "edit_batch"],
  git_read: ["localgit_state", "localgit_log", "localgit_annotate"],
  git_write: ["git_commit"],
  research: [
    "codesearch",
    "gh_grep_searchGitHub",
    "context7_resolve-library-id",
    "context7_query-docs",
    "microsoft-learn_microsoft_docs_search",
    "microsoft-learn_microsoft_code_sample_search",
    "microsoft-learn_microsoft_docs_fetch",
  ],
  web: ["webfetch", "websearch", "lib_batch"],
  browser: ["playwright_*"],
  storybook: ["storybookmcp_*"],
} as const satisfies Record<string, readonly string[]>

export const teamPermissionNames = ["map", "git_read", "git_write", "research", "web", "browser", "storybook"] as const
