import { HttpApi, OpenApi } from "effect/unstable/httpapi"
import { SchemaErrorMiddleware } from "./middleware/schema-error"
import { MessageGroup } from "./groups/message"
import { ModelGroup } from "./groups/model"
import { ProviderGroup } from "./groups/provider"
import { SessionGroup } from "./groups/session"
import { PermissionGroup } from "./groups/permission"
import { FileSystemGroup } from "./groups/fs"
import { CommandGroup } from "./groups/command"
import { SkillGroup } from "./groups/skill"
import { EventGroup } from "./groups/event"
import { AgentGroup } from "./groups/agent"
import { HealthGroup } from "./groups/health"
import { QuestionGroup } from "./groups/question"
import { ReferenceGroup } from "./groups/reference"
import { Authorization } from "./middleware/authorization"
import { LocationGroup } from "./groups/location"
import { IntegrationGroup } from "./groups/integration"
import { CredentialGroup } from "./groups/credential"

export const Api = HttpApi.make("server")
  .add(HealthGroup)
  .add(LocationGroup)
  .add(AgentGroup)
  .add(SessionGroup)
  .add(MessageGroup)
  .add(ModelGroup)
  .add(ProviderGroup)
  .add(IntegrationGroup)
  .add(CredentialGroup)
  .add(PermissionGroup)
  .add(FileSystemGroup)
  .add(CommandGroup)
  .add(SkillGroup)
  .add(EventGroup)
  .add(QuestionGroup)
  .add(ReferenceGroup)
  .annotateMerge(
    OpenApi.annotations({
      title: "opencode HttpApi",
      version: "0.0.1",
      description: "Experimental HttpApi surface for selected instance routes.",
    }),
  )
  .middleware(Authorization)
  .middleware(SchemaErrorMiddleware)
