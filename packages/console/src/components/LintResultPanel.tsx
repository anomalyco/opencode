import type { LintError, LintResult } from '../hooks'

interface LintResultPanelProps {
  lintResult: LintResult | null
  isChecking: boolean
  onFixErrors?: () => void
  onStartPreview?: () => void
}

export default function LintResultPanel({
  lintResult,
  isChecking,
  onFixErrors,
  onStartPreview,
}: LintResultPanelProps) {
  // Loading state
  if (isChecking) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-gray-900 p-8">
        <div className="text-gray-500 mb-4 animate-spin">
          <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </div>
        <p className="text-gray-400 text-sm">Running lint check...</p>
      </div>
    )
  }

  // No result yet
  if (!lintResult) {
    return null
  }

  // Has errors - show error blocking page
  if (!lintResult.success && lintResult.error_count > 0) {
    return (
      <div className="flex flex-col h-full bg-red-900/10 border-l-4 border-red-500">
        {/* Header */}
        <div className="px-6 py-4 bg-red-900/20 border-b border-red-800/50">
          <div className="flex items-center gap-3">
            <div className="text-red-500">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-red-400">Lint Errors Found</h3>
              <p className="text-sm text-red-300/70">
                {lintResult.error_count} error{lintResult.error_count !== 1 ? 's' : ''}
                {lintResult.warning_count > 0 && `, ${lintResult.warning_count} warning${lintResult.warning_count !== 1 ? 's' : ''}`}
              </p>
            </div>
          </div>
        </div>

        {/* Error List */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="space-y-2">
            {lintResult.errors
              .filter(e => e.severity === 'error')
              .map((error, idx) => (
                <LintErrorItem key={idx} error={error} />
              ))}
            
            {/* Show warnings if any */}
            {lintResult.warning_count > 0 && (
              <>
                <div className="text-xs text-gray-500 mt-4 mb-2">Warnings</div>
                {lintResult.errors
                  .filter(e => e.severity === 'warning')
                  .slice(0, 5) // Limit warnings shown
                  .map((error, idx) => (
                    <LintErrorItem key={`warn-${idx}`} error={error} />
                  ))}
                {lintResult.warning_count > 5 && (
                  <p className="text-xs text-gray-500">
                    ...and {lintResult.warning_count - 5} more warnings
                  </p>
                )}
              </>
            )}
          </div>
        </div>

        {/* Action Button */}
        <div className="px-6 py-4 bg-red-900/20 border-t border-red-800/50">
          <button
            onClick={onFixErrors}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 4a2 2 0 114 0v1a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 01-1 1h-1a2 2 0 100 4h1a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-1a2 2 0 10-4 0v1a1 1 0 01-1 1H7a1 1 0 01-1-1v-3a1 1 0 00-1-1H4a2 2 0 110-4h1a1 1 0 001-1V7a1 1 0 011-1h3a1 1 0 001-1V4z" />
            </svg>
            Fix Lint Errors
          </button>
        </div>
      </div>
    )
  }

  // Success - no errors
  return (
    <div className="flex flex-col items-center justify-center h-full bg-green-900/10 p-8">
      <div className="text-green-500 mb-4">
        <svg className="w-16 h-16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </div>
      <h3 className="text-xl font-semibold text-green-400 mb-2">No Lint Errors</h3>
      <p className="text-gray-400 text-sm mb-6 text-center">
        Your code passed all lint checks.
        {lintResult.warning_count > 0 && (
          <span className="block text-yellow-400/70 mt-1">
            ({lintResult.warning_count} warning{lintResult.warning_count !== 1 ? 's' : ''})
          </span>
        )}
      </p>
      
      <button
        onClick={onStartPreview}
        className="flex items-center gap-2 px-6 py-3 bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg transition-colors"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        Start Preview
      </button>
      
      <p className="text-xs text-gray-500 mt-4 text-center">
        This will run:<br />
        1. Install dependencies<br />
        2. Start dev server
      </p>
    </div>
  )
}

function LintErrorItem({ error }: { error: LintError }) {
  const isWarning = error.severity === 'warning'
  
  return (
    <div className={`flex items-start gap-3 p-3 rounded-lg ${
      isWarning ? 'bg-yellow-900/20 border border-yellow-800/30' : 'bg-red-900/30 border border-red-800/30'
    }`}>
      <span className={`text-sm ${isWarning ? 'text-yellow-500' : 'text-red-500'}`}>
        {isWarning ? '⚠' : '✕'}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 text-xs text-gray-400 mb-1">
          <span className="font-mono truncate">{error.file}</span>
          <span className="text-gray-600">:</span>
          <span>{error.line}:{error.column}</span>
          {error.rule && (
            <>
              <span className="text-gray-600">•</span>
              <span className={`${isWarning ? 'text-yellow-500/70' : 'text-red-500/70'}`}>{error.rule}</span>
            </>
          )}
        </div>
        <p className={`text-sm ${isWarning ? 'text-yellow-200' : 'text-red-200'}`}>
          {error.message}
        </p>
      </div>
    </div>
  )
}
