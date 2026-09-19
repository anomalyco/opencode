import QtQuick
import QtQuick.Shapes
import qs.Commons

// Official OpenCode mark: a 16×20 block O with the recessed inner slab.
// Drawn natively so the bar can tint it with the current foreground.
Item {
  id: root

  property real iconSize: Style.font.icon
  property color color: Color.foreground
  property color shadowColor: Qt.rgba(color.r, color.g, color.b, 0.32)

  width: iconSize
  height: iconSize
  implicitWidth: iconSize
  implicitHeight: iconSize

  readonly property real s: iconSize / 20
  readonly property real markW: 16 * s
  readonly property real markH: 20 * s
  readonly property real ox: (width - markW) / 2
  readonly property real oy: (height - markH) / 2

  Rectangle {
    x: root.ox + 4 * root.s
    y: root.oy + 8 * root.s
    width: 8 * root.s
    height: 8 * root.s
    color: root.shadowColor
  }

  Shape {
    anchors.fill: parent
    antialiasing: true
    layer.enabled: true
    layer.samples: 4

    ShapePath {
      fillColor: root.color
      strokeWidth: 0
      fillRule: ShapePath.OddEvenFill
      startX: root.ox
      startY: root.oy
      PathLine { x: root.ox + root.markW; y: root.oy }
      PathLine { x: root.ox + root.markW; y: root.oy + root.markH }
      PathLine { x: root.ox; y: root.oy + root.markH }
      PathLine { x: root.ox; y: root.oy }
      PathMove { x: root.ox + 4 * root.s; y: root.oy + 4 * root.s }
      PathLine { x: root.ox + 12 * root.s; y: root.oy + 4 * root.s }
      PathLine { x: root.ox + 12 * root.s; y: root.oy + 16 * root.s }
      PathLine { x: root.ox + 4 * root.s; y: root.oy + 16 * root.s }
      PathLine { x: root.ox + 4 * root.s; y: root.oy + 4 * root.s }
    }
  }
}
