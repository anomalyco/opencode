import { Layer, ManagedRuntime } from "effect"
import { AccountService } from "@/account/service"
import { AuthService } from "@/auth/service"

export const runtime = ManagedRuntime.make(Layer.mergeAll(AccountService.defaultLayer, AuthService.defaultLayer))
