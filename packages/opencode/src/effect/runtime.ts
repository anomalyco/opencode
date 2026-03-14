import { Layer, ManagedRuntime } from "effect"
import { AccountService } from "@/account/service"
import { AuthService } from "@/auth/service"
import { QuestionService } from "@/question/service"

export const runtime = ManagedRuntime.make(
  Layer.mergeAll(AccountService.defaultLayer, AuthService.defaultLayer, QuestionService.layer),
)
