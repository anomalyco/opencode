export { createAutoUpdateCheckerHook } from "./hook";
export { isPrereleaseVersion, isDistTag, isPrereleaseOrDistTag, extractChannel, } from "./version-channel";
export { checkForUpdate } from "./checker";
export { invalidatePackage, invalidateCache } from "./cache";
export type { UpdateCheckResult, AutoUpdateCheckerOptions } from "./types";
