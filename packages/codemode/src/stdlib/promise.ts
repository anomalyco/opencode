import type { PromiseMethodName } from "../interpreter/model.js"

export const promiseStatics = new Set<PromiseMethodName>(["all", "allSettled", "race", "any", "resolve", "reject"])
