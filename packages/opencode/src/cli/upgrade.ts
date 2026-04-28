import { Bus } from "@/bus"
import { Config } from "@/config/config"
import { Flag } from "@/flag/flag"
import { Installation } from "@/installation"

// Mammouth manages its own updates — skip upstream opencode update check
export async function upgrade() {
  return
}
