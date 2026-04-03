/// <reference types="@solidjs/start/env" />

import type { Actor } from "@opencode-ai/console-core/actor.js"

declare global {
  namespace App {
    interface RequestEventLocals {
      actor?: Promise<Actor.Info>
    }
  }
}

export {}
