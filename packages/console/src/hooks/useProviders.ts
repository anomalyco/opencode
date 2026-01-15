import { useState, useEffect, useCallback } from 'react'
import { opencode, type Provider, type ProviderModel, type ProvidersResponse } from '../lib'

export interface FreeModel {
  providerID: string
  modelID: string
  name: string
  model: ProviderModel
}

export interface SelectedModel {
  providerID: string
  modelID: string
}

const STORAGE_KEY = 'af.selectedModel'
const DEFAULT_MODEL: SelectedModel = {
  providerID: 'opencode',
  modelID: 'gpt-5-nano',
}

export function useProviders() {
  const [providers, setProviders] = useState<Provider[]>([])
  const [freeModels, setFreeModels] = useState<FreeModel[]>([])
  const [connected, setConnected] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedModel, setSelectedModelState] = useState<SelectedModel>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        return JSON.parse(stored)
      }
    } catch {
      // Ignore parse errors
    }
    return DEFAULT_MODEL
  })

  // Fetch providers from OpenCode server
  const fetchProviders = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      const response = await opencode.getProviders()
      setProviders(response.all)
      setConnected(response.connected)

      // Extract free models from 'opencode' provider
      const freeModelsList: FreeModel[] = []
      
      for (const provider of response.all) {
        // Focus on opencode provider for free models
        if (provider.id === 'opencode') {
          for (const [modelID, model] of Object.entries(provider.models)) {
            if (model.cost?.input === 0) {
              freeModelsList.push({
                providerID: provider.id,
                modelID,
                name: model.name || modelID,
                model,
              })
            }
          }
        }
      }

      setFreeModels(freeModelsList)
    } catch (err: any) {
      setError(err?.message || 'Failed to fetch providers')
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Initial fetch
  useEffect(() => {
    fetchProviders()
  }, [fetchProviders])

  // Set selected model and persist to localStorage
  const setSelectedModel = useCallback((model: SelectedModel) => {
    setSelectedModelState(model)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(model))
    } catch {
      // Ignore storage errors
    }
  }, [])

  // Get current model details
  const getCurrentModelDetails = useCallback((): FreeModel | null => {
    return freeModels.find(
      (m) => m.providerID === selectedModel.providerID && m.modelID === selectedModel.modelID
    ) || null
  }, [freeModels, selectedModel])

  return {
    providers,
    freeModels,
    connected,
    isLoading,
    error,
    selectedModel,
    setSelectedModel,
    getCurrentModelDetails,
    refreshProviders: fetchProviders,
  }
}
