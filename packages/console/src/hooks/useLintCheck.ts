import { useState, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'

export interface LintError {
  file: string
  line: number
  column: number
  message: string
  severity: 'error' | 'warning'
  rule?: string
}

export interface LintResult {
  success: boolean
  errors: LintError[]
  error_count: number
  warning_count: number
}

interface UseLintCheckOptions {
  rootPath?: string
  onComplete?: (result: LintResult) => void
}

export function useLintCheck({ rootPath, onComplete }: UseLintCheckOptions = {}) {
  const [lintResult, setLintResult] = useState<LintResult | null>(null)
  const [isChecking, setIsChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Run lint check
  const runLintCheck = useCallback(async (path?: string) => {
    const checkPath = path || rootPath
    if (!checkPath) {
      setError('No path specified for lint check')
      return null
    }

    setIsChecking(true)
    setError(null)

    try {
      const result = await invoke<LintResult>('run_lint_check', { path: checkPath })
      setLintResult(result)
      onComplete?.(result)
      return result
    } catch (err: any) {
      const errorMessage = err?.toString() || 'Failed to run lint check'
      setError(errorMessage)
      console.error('Lint check failed:', err)
      return null
    } finally {
      setIsChecking(false)
    }
  }, [rootPath, onComplete])

  // Clear lint result
  const clearLintResult = useCallback(() => {
    setLintResult(null)
    setError(null)
  }, [])

  // Computed values
  const isLintClean = lintResult?.success ?? false
  const hasErrors = (lintResult?.error_count ?? 0) > 0
  const hasWarnings = (lintResult?.warning_count ?? 0) > 0
  const errorCount = lintResult?.error_count ?? 0
  const warningCount = lintResult?.warning_count ?? 0
  const lintErrors = lintResult?.errors ?? []

  // Format errors for display
  const formatErrorForAI = useCallback(() => {
    if (!lintResult || lintResult.success) return ''
    
    const errorLines = lintResult.errors
      .filter(e => e.severity === 'error')
      .map(e => `- ${e.file}:${e.line}:${e.column} - ${e.message}${e.rule ? ` (${e.rule})` : ''}`)
      .join('\n')

    return `Please fix the following TypeScript lint errors:\n\n${errorLines}`
  }, [lintResult])

  return {
    // State
    lintResult,
    lintErrors,
    isChecking,
    error,
    
    // Computed
    isLintClean,
    hasErrors,
    hasWarnings,
    errorCount,
    warningCount,

    // Actions
    runLintCheck,
    clearLintResult,
    formatErrorForAI,
  }
}
