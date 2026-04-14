import { lazy } from "@/util/lazy"
import { Hono } from "hono"
import { PermissionHttpApiHandler } from "./permission"
import { QuestionHttpApiHandler } from "./question"

export const HttpApiRoutes = lazy(() =>
  new Hono()
    .all("/question", QuestionHttpApiHandler)
    .all("/question/*", QuestionHttpApiHandler)
    .all("/permission", PermissionHttpApiHandler)
    .all("/permission/*", PermissionHttpApiHandler),
)
