import { createContext, useContext } from "solid-js"

export type LocalImageResolver = (path: string, directory: string) => Promise<string | undefined>

const ctx = createContext<LocalImageResolver>()

export const LocalImageProvider = ctx.Provider
export const useLocalImageResolver = () => useContext(ctx)
