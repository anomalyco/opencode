import { HttpApi, OpenApi } from "effect/unstable/httpapi"
import { SchemaErrorMiddleware } from "./middleware/schema-error"
import { MessageGroup } from "./groups/v2/message"
import { ModelGroup } from "./groups/v2/model"
import { ProviderGroup } from "./groups/v2/provider"
import { SessionGroup } from "./groups/v2/session"
import { PermissionGroup, PermissionSavedGroup, SessionPermissionGroup } from "./groups/v2/permission"
import { FileSystemGroup } from "./groups/v2/fs"
import { CommandGroup } from "./groups/v2/command"
import { SkillGroup } from "./groups/v2/skill"
import { EventGroup } from "./groups/v2/event"
import { AgentGroup } from "./groups/v2/agent"
import { HealthGroup } from "./groups/v2/health"
import { QuestionGroup, SessionQuestionGroup } from "./groups/v2/question"

export const V2Api = HttpApi.make("v2")
  .add(HealthGroup)
  .add(AgentGroup)
  .add(SessionGroup)
  .add(MessageGroup)
  .add(ModelGroup)
  .add(ProviderGroup)
  .add(PermissionGroup)
  .add(SessionPermissionGroup)
  .add(PermissionSavedGroup)
  .add(FileSystemGroup)
  .add(CommandGroup)
  .add(SkillGroup)
  .add(EventGroup)
  .add(QuestionGroup)
  .add(SessionQuestionGroup)
  .annotateMerge(
    OpenApi.annotations({
      title: "opencode experimental HttpApi",
      version: "0.0.1",
      description: "Experimental HttpApi surface for selected instance routes.",
    }),
  )
  .middleware(SchemaErrorMiddleware)
