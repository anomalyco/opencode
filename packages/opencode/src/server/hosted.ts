import { Flag } from "@/flag/flag"

const HOSTED_FILESYSTEM_DISABLED_MESSAGE =
  "Hosted local filesystem access is disabled in this deployment."

export function localFilesystemDisabled() {
  return Flag.OPENCODE_DISABLE_LOCAL_FILESYSTEM
}

export function hostedFilesystemDisabledResponse() {
  return new Response(
    JSON.stringify({
      error: HOSTED_FILESYSTEM_DISABLED_MESSAGE,
    }),
    {
      status: 501,
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
    },
  )
}

export function assertHostedFilesystemEnabled() {
  if (!localFilesystemDisabled()) return
  throw new Error(HOSTED_FILESYSTEM_DISABLED_MESSAGE)
}
