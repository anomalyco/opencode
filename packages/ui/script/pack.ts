#!/usr/bin/env bun
import path from "node:path"
import { pack } from "@Mackery6969/script/pack"

await pack(path.resolve(import.meta.dir, ".."), { source: true })
