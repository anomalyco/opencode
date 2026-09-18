import { app } from "electron"

type Channel = "dev" | "beta" | "prod" | "muc" | "muc"
const raw = import.meta.env.OPENCODE_CHANNEL
export const CHANNEL: Channel =
  raw === "dev" || raw === "beta" || raw === "prod" || raw === "muc" ? raw : "dev"

// MUC Harness: muc 通道不接入上游自动更新（发布走自有渠道），且避免网络阻塞启动
export const UPDATER_ENABLED = app.isPackaged && CHANNEL !== "dev" && CHANNEL !== "muc"
