import { ManagedRuntime } from "effect"
import { AccountService } from "@/account/service"

export const runtime = ManagedRuntime.make(AccountService.defaultLayer)
