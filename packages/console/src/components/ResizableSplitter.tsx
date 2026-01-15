interface ResizableSplitterProps {
  onMouseDown: (e: React.MouseEvent) => void
  onDoubleClick: () => void
  isDragging: boolean
}

export default function ResizableSplitter({
  onMouseDown,
  onDoubleClick,
  isDragging,
}: ResizableSplitterProps) {
  return (
    <div
      className={`relative flex-shrink-0 w-1 cursor-col-resize group ${
        isDragging ? 'bg-blue-500' : 'bg-gray-700 hover:bg-blue-400'
      } transition-colors`}
      onMouseDown={onMouseDown}
      onDoubleClick={onDoubleClick}
      title="Drag to resize. Double-click to reset."
    >
      {/* Visual handle indicator */}
      <div
        className={`absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-1 h-8 rounded-full ${
          isDragging
            ? 'bg-blue-300'
            : 'bg-gray-500 group-hover:bg-blue-300'
        } transition-colors`}
      />

      {/* Invisible wider hit area for easier grabbing */}
      <div className="absolute inset-y-0 -left-1 -right-1" />
    </div>
  )
}
