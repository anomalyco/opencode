import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import { upgradeWebSocket } from "hono/bun"
import z from "zod"
import { VpsConnection } from "@/vps/connection"
import { VpsContext } from "@/vps/context"
import { VpsPty } from "@/vps/pty"
import { VpsSftp } from "@/vps/sftp"
import { Config } from "@/config/config"
import { Storage } from "../../storage/storage"
import { errors } from "../error"
import { lazy } from "../../util/lazy"

export const VpsRoutes = lazy(() =>
  new Hono()
    // ==================== VPS Configuration ====================
    .get(
      "/config",
      describeRoute({
        summary: "List VPS configurations",
        description: "Get all configured VPS connections from the config file.",
        operationId: "vps.config.list",
        responses: {
          200: {
            description: "List of VPS configurations",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    vps: z.record(
                      z.string(),
                      z.object({
                        host: z.string(),
                        port: z.number(),
                        user: z.string(),
                        nickname: z.string().optional(),
                        authType: z.string(),
                      })
                    ),
                  })
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        const config = await Config.get()
        const vpsConfigs = config.vps || {}

        const result: Record<string, any> = {}
        for (const [key, cfg] of Object.entries(vpsConfigs)) {
          result[key] = {
            host: cfg.host,
            port: cfg.port || 22,
            user: cfg.user,
            nickname: cfg.nickname || key,
            authType: cfg.auth.type,
          }
        }

        return c.json({ vps: result })
      }
    )

    // ==================== VPS Connections ====================
    .get(
      "/connection",
      describeRoute({
        summary: "List active VPS connections",
        description: "Get all currently active VPS SSH connections.",
        operationId: "vps.connection.list",
        responses: {
          200: {
            description: "List of active connections",
            content: {
              "application/json": {
                schema: resolver(z.object({ connections: VpsConnection.Info.array() })),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json({ connections: VpsConnection.list() })
      }
    )
    .post(
      "/connection/:configKey",
      describeRoute({
        summary: "Connect to VPS",
        description: "Establish an SSH connection to a configured VPS server.",
        operationId: "vps.connection.connect",
        responses: {
          200: {
            description: "Connection established",
            content: {
              "application/json": {
                schema: resolver(z.object({ info: VpsConnection.Info })),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ configKey: z.string() })),
      validator(
        "json",
        z
          .object({
            password: z.string().optional(),
          })
          .optional()
      ),
      async (c) => {
        const { configKey } = c.req.valid("param")
        const body = c.req.valid("json")

        const config = await Config.get()
        const vpsConfig = config.vps?.[configKey]

        if (!vpsConfig) {
          throw new Storage.NotFoundError({ message: `VPS configuration '${configKey}' not found` })
        }

        // Check if already connected
        const existing = VpsConnection.getByKey(configKey)
        if (existing && existing.status === "connected") {
          return c.json({ info: existing })
        }

        const info = await VpsConnection.connect(configKey, vpsConfig, {
          password: body?.password,
        })

        return c.json({ info })
      }
    )
    .delete(
      "/connection/:vpsId",
      describeRoute({
        summary: "Disconnect from VPS",
        description: "Close an active SSH connection to a VPS server.",
        operationId: "vps.connection.disconnect",
        responses: {
          200: {
            description: "Disconnected",
            content: {
              "application/json": {
                schema: resolver(z.object({ success: z.boolean() })),
              },
            },
          },
        },
      }),
      validator("param", z.object({ vpsId: z.string() })),
      async (c) => {
        const { vpsId } = c.req.valid("param")
        VpsConnection.disconnect(vpsId)
        return c.json({ success: true })
      }
    )
    .get(
      "/connection/:vpsId",
      describeRoute({
        summary: "Get VPS connection",
        description: "Get details about a specific VPS connection.",
        operationId: "vps.connection.get",
        responses: {
          200: {
            description: "Connection info",
            content: {
              "application/json": {
                schema: resolver(VpsConnection.Info),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ vpsId: z.string() })),
      async (c) => {
        const { vpsId } = c.req.valid("param")
        const info = VpsConnection.get(vpsId)
        if (!info) {
          throw new Storage.NotFoundError({ message: "VPS connection not found" })
        }
        return c.json(info)
      }
    )

    // ==================== VPS Context ====================
    .get(
      "/context",
      describeRoute({
        summary: "Get current context",
        description: "Get the current execution context (local or VPS).",
        operationId: "vps.context.get",
        responses: {
          200: {
            description: "Current context",
            content: {
              "application/json": {
                schema: resolver(VpsContext.Info),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(VpsContext.getCurrent())
      }
    )
    .post(
      "/context/switch",
      describeRoute({
        summary: "Switch context",
        description: "Switch execution context between local and VPS.",
        operationId: "vps.context.switch",
        responses: {
          200: {
            description: "Context switched",
            content: {
              "application/json": {
                schema: resolver(VpsContext.Info),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "json",
        z.discriminatedUnion("type", [
          z.object({ type: z.literal("local") }),
          z.object({
            type: z.literal("vps"),
            vpsId: z.string(),
            configKey: z.string(),
            nickname: z.string(),
            directory: z.string().optional(),
          }),
        ])
      ),
      async (c) => {
        const body = c.req.valid("json")

        if (body.type === "local") {
          VpsContext.switchToLocal()
        } else {
          VpsContext.switchToVps(body.vpsId, body.configKey, body.nickname, body.directory)
        }

        return c.json(VpsContext.getCurrent())
      }
    )

    // ==================== VPS PTY (Terminal) ====================
    .get(
      "/pty",
      describeRoute({
        summary: "List VPS PTY sessions",
        description: "Get all active VPS pseudo-terminal sessions.",
        operationId: "vps.pty.list",
        responses: {
          200: {
            description: "List of VPS PTY sessions",
            content: {
              "application/json": {
                schema: resolver(z.object({ sessions: VpsPty.Info.array() })),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json({ sessions: VpsPty.list() })
      }
    )
    .post(
      "/pty",
      describeRoute({
        summary: "Create VPS PTY session",
        description: "Create a new interactive terminal session on a VPS.",
        operationId: "vps.pty.create",
        responses: {
          200: {
            description: "VPS PTY session created",
            content: {
              "application/json": {
                schema: resolver(z.object({ info: VpsPty.Info })),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", VpsPty.CreateInput),
      async (c) => {
        const input = c.req.valid("json")
        const info = await VpsPty.create(input)
        return c.json({ info })
      }
    )
    .get(
      "/pty/:ptyId",
      describeRoute({
        summary: "Get VPS PTY session",
        description: "Get details about a specific VPS PTY session.",
        operationId: "vps.pty.get",
        responses: {
          200: {
            description: "VPS PTY session info",
            content: {
              "application/json": {
                schema: resolver(VpsPty.Info),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ ptyId: z.string() })),
      async (c) => {
        const { ptyId } = c.req.valid("param")
        const info = VpsPty.get(ptyId)
        if (!info) {
          throw new Storage.NotFoundError({ message: "VPS PTY session not found" })
        }
        return c.json(info)
      }
    )
    .delete(
      "/pty/:ptyId",
      describeRoute({
        summary: "Remove VPS PTY session",
        description: "Close and remove a VPS PTY session.",
        operationId: "vps.pty.remove",
        responses: {
          200: {
            description: "VPS PTY session removed",
            content: {
              "application/json": {
                schema: resolver(z.object({ success: z.boolean() })),
              },
            },
          },
        },
      }),
      validator("param", z.object({ ptyId: z.string() })),
      async (c) => {
        const { ptyId } = c.req.valid("param")
        await VpsPty.remove(ptyId)
        return c.json({ success: true })
      }
    )
    .post(
      "/pty/:ptyId/resize",
      describeRoute({
        summary: "Resize VPS PTY session",
        description: "Resize the terminal window of a VPS PTY session.",
        operationId: "vps.pty.resize",
        responses: {
          200: {
            description: "VPS PTY session resized",
            content: {
              "application/json": {
                schema: resolver(z.object({ success: z.boolean() })),
              },
            },
          },
        },
      }),
      validator("param", z.object({ ptyId: z.string() })),
      validator("json", z.object({ cols: z.number(), rows: z.number() })),
      async (c) => {
        const { ptyId } = c.req.valid("param")
        const { cols, rows } = c.req.valid("json")
        VpsPty.resize(ptyId, cols, rows)
        return c.json({ success: true })
      }
    )
    .get(
      "/pty/:ptyId/connect",
      describeRoute({
        summary: "Connect to VPS PTY session",
        description: "Establish a WebSocket connection to a VPS PTY session.",
        operationId: "vps.pty.connect",
        responses: {
          200: {
            description: "Connected",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ ptyId: z.string() })),
      upgradeWebSocket((c) => {
        const id = c.req.param("ptyId")
        let handler: ReturnType<typeof VpsPty.connect>
        if (!VpsPty.get(id)) throw new Error("VPS PTY session not found")
        return {
          onOpen(_event, ws) {
            handler = VpsPty.connect(id, ws)
          },
          onMessage(event) {
            handler?.onMessage(String(event.data))
          },
          onClose() {
            handler?.onClose()
          },
        }
      })
    )

    // ==================== VPS File Operations (SFTP) ====================
    .post(
      "/file/read",
      describeRoute({
        summary: "Read remote file",
        description: "Read a file from a VPS server via SFTP.",
        operationId: "vps.file.read",
        responses: {
          200: {
            description: "File content",
            content: {
              "application/json": {
                schema: resolver(z.object({ content: z.string() })),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "json",
        z.object({
          vpsId: z.string(),
          path: z.string(),
        })
      ),
      async (c) => {
        const { vpsId, path } = c.req.valid("json")
        const content = await VpsSftp.readFile(vpsId, path)
        return c.json({ content })
      }
    )
    .post(
      "/file/write",
      describeRoute({
        summary: "Write remote file",
        description: "Write a file to a VPS server via SFTP.",
        operationId: "vps.file.write",
        responses: {
          200: {
            description: "File written",
            content: {
              "application/json": {
                schema: resolver(z.object({ success: z.boolean() })),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "json",
        z.object({
          vpsId: z.string(),
          path: z.string(),
          content: z.string(),
        })
      ),
      async (c) => {
        const { vpsId, path, content } = c.req.valid("json")
        await VpsSftp.writeFile(vpsId, path, content)
        return c.json({ success: true })
      }
    )
    .post(
      "/file/list",
      describeRoute({
        summary: "List remote directory",
        description: "List files in a directory on a VPS server.",
        operationId: "vps.file.list",
        responses: {
          200: {
            description: "Directory listing",
            content: {
              "application/json": {
                schema: resolver(z.object({ files: VpsSftp.FileInfo.array() })),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "json",
        z.object({
          vpsId: z.string(),
          path: z.string(),
        })
      ),
      async (c) => {
        const { vpsId, path } = c.req.valid("json")
        const files = await VpsSftp.listDirectory(vpsId, path)
        return c.json({ files })
      }
    )
    .post(
      "/file/stat",
      describeRoute({
        summary: "Get remote file info",
        description: "Get file/directory information from a VPS server.",
        operationId: "vps.file.stat",
        responses: {
          200: {
            description: "File info",
            content: {
              "application/json": {
                schema: resolver(z.object({ info: VpsSftp.FileInfo.nullable() })),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "json",
        z.object({
          vpsId: z.string(),
          path: z.string(),
        })
      ),
      async (c) => {
        const { vpsId, path } = c.req.valid("json")
        const info = await VpsSftp.stat(vpsId, path)
        return c.json({ info })
      }
    )

    // ==================== VPS Command Execution ====================
    .post(
      "/exec",
      describeRoute({
        summary: "Execute remote command",
        description: "Execute a command on a VPS server.",
        operationId: "vps.exec",
        responses: {
          200: {
            description: "Command result",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    stdout: z.string(),
                    stderr: z.string(),
                    exitCode: z.number(),
                  })
                ),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "json",
        z.object({
          vpsId: z.string(),
          command: z.string(),
          cwd: z.string().optional(),
          env: z.record(z.string(), z.string()).optional(),
          timeout: z.number().optional(),
        })
      ),
      async (c) => {
        const { vpsId, command, cwd, env, timeout } = c.req.valid("json")
        const result = await VpsConnection.exec(vpsId, command, { cwd, env, timeout })
        return c.json(result)
      }
    )
)
