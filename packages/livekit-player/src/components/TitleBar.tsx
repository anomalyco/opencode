import { appWindow } from '@tauri-apps/api/window'

export default function TitleBar() {
  const handleMouseDown = () => {
    appWindow.startDragging()
  }

  return (
    <div
      onMouseDown={handleMouseDown}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        height: '40px',
        zIndex: 9998,
        cursor: 'move'
      }}
    />
  )
}
