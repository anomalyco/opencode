import { GitLabProvider } from "./gitlab"
import type { WebhookEvent } from "../provider"

export type WebhookResult = {
  shouldProcess: boolean
  event?: WebhookEvent
  error?: string
}

/**
 * GitLab webhook handler
 * Filters and validates incoming GitLab webhook events
 */
export async function handleGitLabWebhook(
  headers: Headers,
  body: string,
  provider?: GitLabProvider
): Promise<WebhookResult> {
  try {
    // Verify webhook token
    const token = headers.get("x-gitlab-token")
    if (!token) {
      return {
        shouldProcess: false,
        error: "Missing X-Gitlab-Token header",
      }
    }

    // Parse event using provider if available
    let event: WebhookEvent
    if (provider) {
      event = await provider.parseWebhook(headers, body)
    } else {
      const data = JSON.parse(body)
      event = {
        type: data.object_kind === "note" ? "note" : "merge_request",
        objectKind: data.object_kind,
        projectId: data.project?.id || data.project_id,
        mrIid: data.merge_request?.iid || data.object_attributes?.iid,
        author: data.user
          ? { login: data.user.username, name: data.user.name }
          : undefined,
        body: data.object_attributes?.note || data.object_attributes?.description,
      }
    }

    // Filter: only process MR note events
    const data = JSON.parse(body)
    if (event.objectKind === "note") {
      const noteableType = data.object_attributes?.noteable_type
      if (noteableType !== "MergeRequest") {
        return {
          shouldProcess: false,
          error: `Not a MR event: ${noteableType}`,
        }
      }
    }

    return {
      shouldProcess: true,
      event,
    }
  } catch (error) {
    return {
      shouldProcess: false,
      error: String(error),
    }
  }
}
