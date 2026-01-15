import { useState, useRef, useEffect } from 'react'
import { useProviders, type FreeModel, type SelectedModel } from '../hooks'

interface ProviderSelectorProps {
  onModelChange?: (model: SelectedModel) => void
}

export default function ProviderSelector({ onModelChange }: ProviderSelectorProps) {
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const {
    freeModels,
    isLoading,
    error,
    selectedModel,
    setSelectedModel,
    getCurrentModelDetails,
  } = useProviders()

  const currentModel = getCurrentModelDetails()

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleSelectModel = (model: FreeModel) => {
    const selected: SelectedModel = {
      providerID: model.providerID,
      modelID: model.modelID,
    }
    setSelectedModel(selected)
    onModelChange?.(selected)
    setIsOpen(false)
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-700 rounded text-sm text-gray-400">
        <div className="w-3 h-3 border-2 border-gray-500 border-t-transparent rounded-full animate-spin" />
        <span>Loading...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 bg-red-900/30 border border-red-700 rounded text-sm text-red-400">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
        <span>Error</span>
      </div>
    )
  }

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Trigger Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm transition-colors"
      >
        <svg className="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
        <span className="text-gray-200">
          {currentModel?.name || selectedModel.modelID}
        </span>
        <span className="px-1.5 py-0.5 text-xs bg-green-600/30 text-green-400 rounded">
          Free
        </span>
        <svg
          className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute top-full left-0 mt-1 w-64 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-50 overflow-hidden">
          <div className="px-3 py-2 border-b border-gray-700">
            <h3 className="text-xs font-medium text-gray-400 uppercase">Free Models</h3>
          </div>
          <div className="max-h-64 overflow-y-auto">
            {freeModels.length === 0 ? (
              <div className="px-3 py-4 text-center text-gray-500 text-sm">
                No free models available
              </div>
            ) : (
              freeModels.map((model) => {
                const isSelected =
                  model.providerID === selectedModel.providerID &&
                  model.modelID === selectedModel.modelID

                return (
                  <button
                    key={`${model.providerID}-${model.modelID}`}
                    onClick={() => handleSelectModel(model)}
                    className={`w-full flex items-center justify-between px-3 py-2 text-left text-sm transition-colors ${
                      isSelected
                        ? 'bg-blue-600/20 text-blue-300'
                        : 'text-gray-300 hover:bg-gray-700'
                    }`}
                  >
                    <div className="flex flex-col">
                      <span className="font-medium">{model.name}</span>
                      <span className="text-xs text-gray-500">{model.modelID}</span>
                    </div>
                    {isSelected && (
                      <svg className="w-4 h-4 text-blue-400" fill="currentColor" viewBox="0 0 20 20">
                        <path
                          fillRule="evenodd"
                          d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                          clipRule="evenodd"
                        />
                      </svg>
                    )}
                  </button>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
