import { lazy } from "solid-js"

export const TargetSessionRoute = lazy(() => import("./target-session-route"))
export const preloadSessionRoute = TargetSessionRoute.preload
