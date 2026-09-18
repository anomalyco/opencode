import { app } from "electron"

type Channel = "dev" | "beta" | "prod" | "muc" | "hubu"
const raw = import.meta.env.OPENCODE_CHANNEL
export const CHANNEL: Channel =
  raw === "dev" || raw === "beta" || raw === "prod" || raw === "muc" || raw === "hubu" ? raw : "dev"

// 校园 Harness: 校园通道（muc/hubu）不接入上游自动更新（发布走自有渠道），且避免网络阻塞启动
export const UPDATER_ENABLED =
  app.isPackaged && CHANNEL !== "dev" && CHANNEL !== "muc" && CHANNEL !== "hubu"
