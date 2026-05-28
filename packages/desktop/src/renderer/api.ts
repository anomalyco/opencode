import type { ElectronAPI } from "../preload/types"

export const desktopApi = window.api as ElectronAPI
export const api = desktopApi
