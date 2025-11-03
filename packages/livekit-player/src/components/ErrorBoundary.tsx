import { Component, ErrorInfo, ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error?: Error
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          flexDirection: 'column',
          padding: '20px',
          textAlign: 'center',
          gap: '20px'
        }}>
          <div style={{
            fontSize: '48px',
            marginBottom: '10px'
          }}>⚠️</div>
          <h1 style={{ fontSize: '24px', color: '#ff4444', margin: 0 }}>
            Something went wrong
          </h1>
          <p style={{ color: '#999', maxWidth: '500px' }}>
            {this.state.error?.message || 'An unexpected error occurred'}
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '12px 24px',
              background: '#4ade80',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              color: '#000',
              fontSize: '16px',
              fontWeight: '600'
            }}
          >
            Reload Application
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
