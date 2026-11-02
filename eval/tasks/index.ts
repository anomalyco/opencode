import type { Task } from "../types"
import { cacheDedupe } from "./cache-dedupe"
import { cliJson } from "./cli-json"
import { control } from "./control"
import { durationParser } from "./duration-parser"
import { importFix } from "./import-fix"
import { navigation } from "./navigation"
import { rangeInclusive } from "./range-inclusive"
import { renameApi } from "./rename-api"
import { slugify } from "./slugify"
import { testRepair } from "./test-repair"
import { todoStore } from "./todo-store"

export const tasks: Task[] = [
  rangeInclusive,
  cacheDedupe,
  slugify,
  renameApi,
  testRepair,
  importFix,
  navigation,
  cliJson,
  todoStore,
  durationParser,
  control,
]
