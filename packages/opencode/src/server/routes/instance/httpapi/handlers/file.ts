import * as InstanceState from "@/effect/instance-state"
import { File } from "@/file"
import { Ripgrep } from "@/file/ripgrep"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
// FORK: office routes handlers(office-routes-effect-httpapi 2026-05-03)
import path from "path"
import * as LibreOffice from "@/file/libreoffice"
import * as OfficeInstaller from "@/file/office-installer"

export const fileHandlers = HttpApiBuilder.group(InstanceHttpApi, "file", (handlers) =>
  Effect.gen(function* () {
    const svc = yield* File.Service
    const ripgrep = yield* Ripgrep.Service

    const findText = Effect.fn("FileHttpApi.findText")(function* (ctx: { query: { pattern: string } }) {
      return (yield* ripgrep
        .search({ cwd: (yield* InstanceState.context).directory, pattern: ctx.query.pattern, limit: 10 })
        .pipe(Effect.orDie)).items
    })

    const findFile = Effect.fn("FileHttpApi.findFile")(function* (ctx: {
      query: { query: string; dirs?: "true" | "false"; type?: "file" | "directory"; limit?: number }
    }) {
      return yield* svc.search({
        query: ctx.query.query,
        limit: ctx.query.limit ?? 10,
        dirs: ctx.query.dirs !== "false",
        type: ctx.query.type,
      })
    })

    const findSymbol = Effect.fn("FileHttpApi.findSymbol")(function* () {
      return []
    })

    const list = Effect.fn("FileHttpApi.list")(function* (ctx: { query: { path: string } }) {
      return yield* svc.list(ctx.query.path)
    })

    const content = Effect.fn("FileHttpApi.content")(function* (ctx: { query: { path: string } }) {
      return yield* svc.read(ctx.query.path)
    })

    const status = Effect.fn("FileHttpApi.status")(function* () {
      return yield* svc.status()
    })

    // FORK-BEGIN: office routes handlers(office-routes-effect-httpapi 2026-05-03)
    const officePdf = Effect.fn("FileHttpApi.officePdf")(function* (ctx: { query: { path: string } }) {
      const filePath = ctx.query.path
      const directory = (yield* InstanceState.context).directory
      const full = path.isAbsolute(filePath) ? filePath : path.join(directory, filePath)
      const bytes = yield* Effect.promise(() => LibreOffice.convertToPdf(full).catch(() => undefined))
      if (!bytes || bytes.length === 0) return new Uint8Array()
      return bytes
    })

    const officeToolingStatus = Effect.fn("FileHttpApi.officeToolingStatus")(function* () {
      return yield* Effect.promise(() => OfficeInstaller.status())
    })

    const officeToolingInstall = Effect.fn("FileHttpApi.officeToolingInstall")(function* () {
      // 启动后台 install 但立即返回当前 status(避免 client 等待数分钟下载)
      yield* Effect.promise(() => OfficeInstaller.startInstall())
      return yield* Effect.promise(() => OfficeInstaller.status())
    })

    const officeToolingProgress = Effect.fn("FileHttpApi.officeToolingProgress")(function* () {
      return OfficeInstaller.getProgress()
    })
    // FORK-END

    return handlers
      .handle("findText", findText)
      .handle("findFile", findFile)
      .handle("findSymbol", findSymbol)
      .handle("list", list)
      .handle("content", content)
      .handle("status", status)
      // FORK-BEGIN: office routes handler 注册(office-routes-effect-httpapi 2026-05-03)
      .handle("officePdf", officePdf)
      .handle("officeToolingStatus", officeToolingStatus)
      .handle("officeToolingInstall", officeToolingInstall)
      .handle("officeToolingProgress", officeToolingProgress)
    // FORK-END
  }),
)
