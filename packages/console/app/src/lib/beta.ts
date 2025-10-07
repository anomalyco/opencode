import { query } from "@solidjs/router"
import { Resource } from "@opencode-ai/console-resource"

export const beta = query(async (workspaceID?: string) => {
  "use server"
  return Resource.App.stage === "production" ? workspaceID === "wrk_01K46JDFR0E75SG2Q8K172KF3Y" : true
}, "beta")
