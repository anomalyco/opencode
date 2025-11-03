import { X } from 'lucide-react'

export default function CloseButton() {
  const handleClose = async () => {
    // @ts-ignore - Tauri API
    if (window.__TAURI__) {
      const { exit } = window.__TAURI__.process
      await exit(0)
    } else {
      window.close()
    }
  }

  return (
    <button
      onClick={handleClose}
      style={{
        position: 'fixed',
        top: '12px',
        right: '12px',
        width: '32px',
        height: '32px',
        borderRadius: '50%',
        border: 'none',
        background: 'transparent',
        color: 'rgba(255, 255, 255, 0.3)',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000,
        transition: 'all 0.2s ease',
        WebkitAppRegion: 'no-drag'
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = 'rgba(255, 255, 255, 0.9)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = 'rgba(255, 255, 255, 0.3)'
      }}
    >
      <X size={16} />
    </button>
  )
}
