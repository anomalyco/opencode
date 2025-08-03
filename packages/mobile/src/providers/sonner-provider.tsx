import React, { createContext, useContext, useState, useCallback } from "react"
import type { SonnerConfig, SonnerContextType, SonnerUpdate } from "@/types/sonner"

const SonnerContext = createContext<SonnerContextType | null>(null)

export const useSonner = () => {
  const context = useContext(SonnerContext)
  if (!context) {
    throw new Error("useSonner must be used within a SonnerProvider")
  }
  return context
}

interface SonnerProviderProps {
  children: React.ReactNode
}

export const SonnerProvider: React.FC<SonnerProviderProps> = ({ children }) => {
  const [sonners, setSonners] = useState<SonnerConfig[]>([])

  const showSonner = useCallback((config: Omit<SonnerConfig, "id">) => {
    const id = Math.random().toString(36).substr(2, 9)
    const newSonner: SonnerConfig = {
      ...config,
      id,
      updatable: config.updatable ?? true,
    }

    setSonners((prev) => [...prev, newSonner])
    return id
  }, [])

  const updateSonner = useCallback((id: string, updates: SonnerUpdate) => {
    setSonners((prev) =>
      prev.map((sonner) => (sonner.id === id && sonner.updatable ? { ...sonner, ...updates } : sonner)),
    )
  }, [])

  const hideSonner = useCallback((id: string) => {
    setSonners((prev) => prev.filter((sonner) => sonner.id !== id))
  }, [])

  const clearAll = useCallback(() => {
    setSonners([])
  }, [])

  const contextValue: SonnerContextType = {
    sonners,
    showSonner,
    updateSonner,
    hideSonner,
    clearAll,
  }

  return <SonnerContext.Provider value={contextValue}>{children}</SonnerContext.Provider>
}
