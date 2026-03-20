/**
 * 项目路由
 * 处理项目创建等请求
 */
import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { mkdir } from "fs/promises"
import { join } from "path"
import { Global } from "@/global"
import { Token } from "../auth"
import { errors } from "@/server/error"

/**
 * 创建项目请求 Schema
 */
const CreateProjectRequestSchema = z.object({
  name: z.string().min(1, "项目名称不能为空").max(100, "项目名称不能超过100个字符"),
})

/**
 * 创建项目响应 Schema
 */
const CreateProjectResponseSchema = z.object({
  success: z.literal(true),
  path: z.string(),
})

/**
 * 项目路由
 */
export function ProjectRoutes() {
  const app = new Hono()

  /**
   * POST /others/project/create
   * 创建项目
   */
  app.post(
    "/create",
    describeRoute({
      summary: "Create project",
      description: "Create a new project directory in the user's home directory",
      operationId: "project.create",
      responses: {
        200: {
          description: "Project created successfully",
          content: {
            "application/json": {
              schema: resolver(CreateProjectResponseSchema),
            },
          },
        },
        ...errors(400),
      },
    }),
    validator("json", CreateProjectRequestSchema),
    async (c) => {
      const { name } = c.req.valid("json")

      // 尝试从 token 解析 space_path 作为 home
      let home = Global.Path.home
      const authHeader = c.req.header("Authorization")
      if (authHeader?.startsWith("Bearer ")) {
        const token = authHeader.slice(7)
        const user = await Token.extractUser(token)
        if (user?.space_path) {
          home = user.space_path
        }
      }

      // 创建项目目录路径
      const projectPath = join(home, name)

      try {
        // 创建目录
        await mkdir(projectPath, { recursive: true })

        return c.json({
          success: true,
          path: projectPath,
        })
      } catch (error) {
        return c.json(
          {
            success: false,
            message: "创建项目目录失败",
          },
          500,
        )
      }
    },
  )

  return app
}
