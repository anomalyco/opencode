export default function TitleBar() {
  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        height: '40px',
        WebkitAppRegion: 'drag',
        zIndex: 9999,
        pointerEvents: 'auto'
      }}
    />
  )
}
