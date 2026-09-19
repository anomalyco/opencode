import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui
import "Model.js" as Model

Panel {
  id: root
  moduleName: "simon.opencode"
  ipcTarget: "simon.opencode"
  manageIpc: false

  property bool cursorActive: false
  property bool keyboardMoving: false
  property bool activating: false
  property int selectedIndex: 0
  property string viewMode: "latest"
  property string activateSessionId: ""

  readonly property color foreground: bar ? bar.foreground : Color.foreground
  readonly property color urgent: bar ? bar.urgent : Color.urgent
  readonly property color dim: Qt.darker(foreground, 1.55)
  readonly property string fontFamily: bar ? bar.fontFamily : Style.font.family
  readonly property color barIconColor: alarming ? urgent : (service.online ? barForeground : dim)
  readonly property color track: Style.selectedFillFor(foreground, Color.accent)
  readonly property var views: ["latest", "projects", "usage"]
  readonly property int viewIndex: viewMode === "projects" ? 1 : (viewMode === "usage" ? 2 : 0)
  readonly property var rows: viewMode === "projects" ? service.flat : (viewMode === "latest" ? service.latest : [])
  readonly property var selectedSession: {
    if (rows.length === 0) return null
    return rows[Math.max(0, Math.min(selectedIndex, rows.length - 1))]
  }
  readonly property bool alarming: service.runningCount > 0 || service.unreadCount > 0
  readonly property string heroMeta: {
    if (!service.online) return "Service is offline"
    if (service.unreadCount > 0 && service.runningCount === 0) return service.unreadCount + " need attention"
    if (service.runningCount === 0 && service.totalCount > 0) return "Idle"
    if (service.totalCount === 0) return "No sessions yet"
    return service.runningCount + " running"
  }

  // Nothing to report, nothing in the bar: the slot collapses until the shared
  // OpenCode service is reachable, then the icon arrives on its own.
  visible: service.online || service.totalCount > 0
  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  function clampIndex() {
    if (rows.length === 0) {
      selectedIndex = 0
      return
    }
    if (selectedIndex >= rows.length) selectedIndex = rows.length - 1
    if (selectedIndex < 0) selectedIndex = 0
  }

  function moveCursor(dy) {
    if (viewMode === "usage") return
    keyboardMoving = true
    cursorActive = true
    if (rows.length === 0) return
    selectedIndex = Math.max(0, Math.min(rows.length - 1, selectedIndex + dy))
    Qt.callLater(function() { root.keyboardMoving = false })
  }

  function setSessionCursor(index) {
    cursorActive = true
    selectedIndex = index
  }

  function selectView(index) {
    var wrapped = ((index % root.views.length) + root.views.length) % root.views.length
    keyboardMoving = false
    cursorActive = false
    selectedIndex = 0
    viewMode = root.views[wrapped]
    resetScroll()
  }

  function resetScroll() {
    if (panelFlick) panelFlick.contentY = 0
    scrollReset.restart()
  }

  function scrollItemIntoView(item) {
    if (!panelFlick || !item) return
    Qt.callLater(function() {
      if (!item) return
      var margin = Style.space(6)
      var point = item.mapToItem(panelFlick.contentItem, 0, 0)
      var top = point.y
      var bottom = top + item.height
      var viewTop = panelFlick.contentY
      var viewBottom = viewTop + panelFlick.height
      var maxY = Math.max(0, panelFlick.contentHeight - panelFlick.height)
      if (top < viewTop + margin) panelFlick.contentY = Math.max(0, top - margin)
      else if (bottom > viewBottom - margin) panelFlick.contentY = Math.min(maxY, bottom + margin - panelFlick.height)
    })
  }

  function scriptPath() {
    var url = Qt.resolvedUrl("fetch.ts").toString()
    if (url.indexOf("file://") === 0) return decodeURIComponent(url.slice(7))
    return url
  }

  function launchFallback(sessionId) {
    if (!sessionId) return
    Util.execArgv([
      "omarchy-launch-or-focus-tui",
      "--app-id=org.omarchy.opencode." + sessionId,
      "opencode",
      "--session",
      sessionId
    ])
  }

  function attachSession(session) {
    if (!session || !session.id) return
    activateSessionId = session.id
    activating = true
    activateProcess.command = ["bun", scriptPath(), "activate", session.id]
    activateProcess.running = true
  }

  function attachSelected() {
    attachSession(selectedSession)
  }

  function launchNew() {
    Util.execArgv(["omarchy-launch-tui", "opencode"])
    root.close()
  }

  function statusColor(status) {
    if (status === "running" || status === "unread" || status === "failed") return urgent
    return dim
  }

  function statusMark(status) {
    if (status === "running") return "●"
    if (status === "unread") return "◉"
    if (status === "failed") return "!"
    return "○"
  }

  function rowMeta(session) {
    if (!session) return ""
    var parts = []
    if (viewMode === "latest" && session.project !== "") parts.push(session.project)
    if (session.model !== "") parts.push(session.model)
    if (session.age !== "") parts.push(session.age)
    if (session.status !== "running" && session.outcome !== "") parts.push(session.outcome)
    return parts.join(" · ")
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)) }
  function alpha(c, a) { return Qt.rgba(c.r, c.g, c.b, a) }

  function usageSummary() {
    var usage = service.usage || {}
    var parts = []
    if (Number(usage.sessions || 0) > 0) parts.push(usage.sessions + " session" + (usage.sessions === 1 ? "" : "s"))
    if (Number(usage.totalTokens || 0) > 0) parts.push(Model.formatTokenCount(usage.totalTokens) + " tokens")
    if (parts.length === 0) return "No usage today"
    return parts.join(" · ")
  }

  function formatDuration(ms) {
    if (!(ms > 0)) return "now"
    var minutes = Math.floor(ms / 60000)
    var hours = Math.floor(minutes / 60)
    var days = Math.floor(hours / 24)
    if (days > 0) return days + "d " + (hours % 24) + "h"
    if (hours > 0) return hours + "h " + (minutes % 60) + "m"
    return Math.max(1, minutes) + "m"
  }

  function resetMsFor(window) {
    if (!window || !window.resetsAt) return -1
    var ms = Date.parse(String(window.resetsAt))
    return isFinite(ms) ? ms - Date.now() : -1
  }

  function modelTooltip(row) {
    if (!row) return ""
    return "In " + Model.formatTokenCount(row.input)
      + " · out " + Model.formatTokenCount(row.output)
      + " · reasoning " + Model.formatTokenCount(row.reasoning)
      + " · cache read " + Model.formatTokenCount(row.cacheRead)
      + " · cache write " + Model.formatTokenCount(row.cacheWrite)
  }

  function tooltipText() {
    if (service.runningCount > 0) return service.runningCount + " running OpenCode session" + (service.runningCount === 1 ? "" : "s")
    if (service.unreadCount > 0) return service.unreadCount + " OpenCode session" + (service.unreadCount === 1 ? "" : "s") + " need attention"
    return "OpenCode sessions"
  }

  onOpenedChanged: if (opened) {
    cursorActive = false
    if (panelFlick) panelFlick.contentY = 0
    service.refresh()
    Qt.callLater(function() { keyCatcher.forceActiveFocus() })
  }

  Connections {
    target: service
    function onFlatChanged() { root.clampIndex() }
    function onLatestChanged() { root.clampIndex() }
  }

  Service {
    id: service
    settings: root.settings
    opened: root.opened
  }

  Process {
    id: activateProcess
    running: false
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        var activated = false
        try {
          var parsed = JSON.parse(text)
          activated = !!(parsed && parsed.activated)
        } catch (e) {}
        if (!activated) root.launchFallback(root.activateSessionId)
        root.activating = false
        root.close()
      }
    }
    onExited: function(exitCode) {
      if (exitCode !== 0 && root.activating) {
        root.activating = false
        root.launchFallback(root.activateSessionId)
        root.close()
      }
    }
  }

  IpcHandler {
    target: root.ipcTarget
    function open(): void { root.open() }
    function close(): void { root.close() }
    function show(): void { root.open() }
    function hide(): void { root.close() }
    function toggle(): void { root.toggle() }
    function refresh(): string { service.refresh(); return "ok" }
  }

  BarIconButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    active: root.alarming
    useActiveColor: false
    tooltipText: root.tooltipText()
    iconComponent: Component {
      Item {
        OpenCodeIcon {
          anchors.centerIn: parent
          iconSize: Style.space(11)
          color: root.barIconColor
        }
      }
    }
    onPressed: function(buttonCode) {
      if (buttonCode === Qt.RightButton) root.launchNew()
      else if (buttonCode === Qt.MiddleButton) service.refresh()
      else root.toggle()
    }
  }

  KeyboardPanel {
    id: panel
    anchorItem: button
    owner: root
    bar: root.bar
    open: root.opened
    focusTarget: keyCatcher
    contentWidth: panel.fittedContentWidth(Style.space(380))
    contentHeight: Style.space(560)

    PanelKeyCatcher {
      id: keyCatcher
      anchors.fill: parent
      onMoveRequested: function(dx, dy) {
        if (dx !== 0) {
          root.selectView(root.viewIndex + dx)
          return
        }
        if (!root.cursorActive) { root.cursorActive = true; return }
        if (dy !== 0) root.moveCursor(dy)
      }
      onActivateRequested: if (root.cursorActive && root.viewMode !== "usage") root.attachSelected()
      onCloseRequested: root.close()
      onTabRequested: function(direction) { root.switchPanel(direction) }
      onTextKey: function(t) {
        if (t === "r" || t === "R") service.refresh()
        else if (t === "n" || t === "N") root.launchNew()
        else if (t === "h" || t === "H") root.selectView(root.viewIndex - 1)
        else if (t === "l" || t === "L") root.selectView(root.viewIndex + 1)
      }

      Flickable {
        id: panelFlick
        anchors.fill: parent
        contentWidth: width
        contentHeight: column.implicitHeight
        clip: true
        boundsBehavior: Flickable.StopAtBounds
        flickableDirection: Flickable.VerticalFlick
        interactive: contentHeight > height
        ScrollBar.vertical: ScrollBar { policy: ScrollBar.AsNeeded }

        Column {
          id: column
          width: panelFlick.width
          spacing: Style.space(12)

          PanelHero {
            id: hero
            width: parent.width
            title: "OpenCode"
            meta: root.heroMeta
            detail: service.runningCount > 0 ? String(service.runningCount) : ""
            foreground: root.foreground
            fontFamily: root.fontFamily
            iconOpacity: service.online ? 1.0 : 0.5
            iconComponent: Component {
              OpenCodeIcon {
                iconSize: Style.font.display
                color: root.alarming ? root.urgent : root.foreground
              }
            }
          }

          Row {
            id: viewSwitch
            width: parent.width
            spacing: Style.space(4)

            readonly property real cellWidth: (width - spacing * 2) / 3

            Repeater {
              model: [
                { id: "latest", label: "Latest" },
                { id: "projects", label: "Projects" },
                { id: "usage", label: "Usage" }
              ]

              CursorSurface {
                required property var modelData
                required property int index
                width: viewSwitch.cellWidth
                implicitHeight: tabLabel.implicitHeight + Style.space(8)
                current: root.viewMode === modelData.id
                foreground: root.foreground

                Text {
                  id: tabLabel
                  anchors.centerIn: parent
                  textFormat: Text.PlainText
                  text: modelData.label
                  color: root.viewMode === modelData.id ? root.foreground : root.dim
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.caption
                  font.bold: root.viewMode === modelData.id
                }

                MouseArea {
                  anchors.fill: parent
                  cursorShape: Qt.PointingHandCursor
                  onClicked: root.selectView(index)
                }
              }
            }
          }

          Column {
            id: usageSection
            visible: root.viewMode === "usage"
            width: parent.width
            spacing: Style.space(10)

            PanelSeparator {
              foreground: root.foreground
            }

            Column {
              visible: service.goLimits.length > 0
              width: parent.width
              spacing: Style.space(10)

              PanelSectionHeader {
                text: "GO QUOTA"
                foreground: root.foreground
                fontFamily: root.fontFamily
              }

              Repeater {
                model: service.goLimits

                LimitRow {
                  required property var modelData
                  width: usageSection.width
                  window: modelData
                }
              }
            }

            Item {
              width: parent.width
              implicitHeight: Math.max(usageHeader.implicitHeight, usageCost.implicitHeight)

              PanelSectionHeader {
                id: usageHeader
                text: "TODAY"
                foreground: root.foreground
                fontFamily: root.fontFamily
                anchors.left: parent.left
                anchors.verticalCenter: parent.verticalCenter
              }

              Text {
                id: usageCost
                textFormat: Text.PlainText
                text: Model.formatMoney(service.usage.cost)
                color: root.foreground
                font.family: root.fontFamily
                font.pixelSize: Style.font.body
                font.bold: true
                anchors.right: parent.right
                anchors.verticalCenter: parent.verticalCenter
              }
            }

            Text {
              width: parent.width
              text: root.usageSummary()
              color: root.dim
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
            }

            Repeater {
              model: service.usage.models || []

              ModelRow {
                required property var modelData
                width: usageSection.width
                row: modelData
                share: modelData.total / Math.max(1, (service.usage.models[0] ? service.usage.models[0].total : 1))
              }
            }

            Text {
              visible: service.goLimits.length === 0 && Number(service.usage.sessions || 0) === 0
              width: parent.width
              text: "No Go subscription on this machine."
              color: root.dim
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
            }
          }

          Text {
            visible: root.viewMode !== "usage" && service.totalCount === 0
            width: parent.width
            topPadding: Style.space(12)
            text: "No top-level sessions yet.\nRight-click the icon to start one."
            color: root.dim
            font.family: root.fontFamily
            font.pixelSize: Style.font.body
            horizontalAlignment: Text.AlignHCenter
            wrapMode: Text.WordWrap
          }

          Column {
            visible: root.viewMode === "latest" && service.latest.length > 0
            width: parent.width
            spacing: Style.space(6)

            PanelSeparator {
              foreground: root.foreground
            }

            PanelSectionHeader {
              text: "SESSIONS"
              foreground: root.foreground
              fontFamily: root.fontFamily
            }

            Repeater {
              model: service.latest

              SessionRow {
                required property var modelData
                width: column.width
                session: modelData
              }
            }
          }

          Repeater {
            model: root.viewMode === "projects" ? service.grouped : []

            Column {
              required property var modelData
              width: column.width
              spacing: Style.space(6)

              PanelSeparator {
                foreground: root.foreground
              }

              PanelSectionHeader {
                text: String(modelData.label || "Project").toUpperCase()
                foreground: root.foreground
                fontFamily: root.fontFamily
              }

              Repeater {
                model: modelData.sessions

                SessionRow {
                  required property var modelData
                  width: column.width
                  session: modelData
                }
              }
            }
          }

          Text {
            visible: service.totalCount > 0
            width: parent.width
            topPadding: Style.space(4)
            text: "h/l switch tabs · Enter opens a terminal · n new · r refresh"
            color: root.dim
            font.family: root.fontFamily
            font.pixelSize: Style.font.caption
            wrapMode: Text.WordWrap
          }
        }
      }
    }
  }

  Timer {
    id: scrollReset
    interval: 1
    repeat: false
    onTriggered: {
      if (panelFlick) panelFlick.contentY = 0
      scrollResetFollowup.restart()
    }
  }

  Timer {
    id: scrollResetFollowup
    interval: 32
    repeat: false
    onTriggered: if (panelFlick) panelFlick.contentY = 0
  }

  component LimitRow: Column {
    id: limitRow
    property var window: null
    readonly property bool alarming: window && window.percent >= 0.9
    spacing: Style.space(6)

    Item {
      width: parent.width
      implicitHeight: Math.max(limitLabel.implicitHeight, limitValue.implicitHeight)

      Text {
        id: limitLabel
        textFormat: Text.PlainText
        text: limitRow.window ? limitRow.window.title : ""
        color: root.foreground
        font.family: root.fontFamily
        font.pixelSize: Style.font.body
        elide: Text.ElideRight
        anchors.left: parent.left
        anchors.right: limitValue.left
        anchors.rightMargin: Style.space(8)
        anchors.verticalCenter: parent.verticalCenter
      }

      Text {
        id: limitValue
        textFormat: Text.PlainText
        text: limitRow.window ? Math.round(limitRow.window.percent * 100) + "%" : "—"
        color: limitRow.alarming ? root.urgent : root.foreground
        font.family: root.fontFamily
        font.pixelSize: Style.font.caption
        anchors.right: parent.right
        anchors.verticalCenter: parent.verticalCenter
      }
    }

    Item {
      width: parent.width
      implicitHeight: Math.max(Style.space(4), Math.round(Style.spacing.controlHeight * 0.14))

      Rectangle {
        id: meterTrack
        anchors.fill: parent
        radius: height / 2
        color: root.track
      }

      Rectangle {
        anchors.left: meterTrack.left
        anchors.verticalCenter: meterTrack.verticalCenter
        height: meterTrack.height
        radius: meterTrack.radius
        width: meterTrack.width * root.clamp(limitRow.window ? limitRow.window.percent : 0, 0, 1)
        color: limitRow.alarming ? root.urgent : root.foreground
      }
    }

    Text {
      width: parent.width
      textFormat: Text.PlainText
      text: {
        var remainingMs = root.resetMsFor(limitRow.window)
        return remainingMs > 0 ? "Resets in " + root.formatDuration(remainingMs) : ""
      }
      color: root.dim
      font.family: root.fontFamily
      font.pixelSize: Style.font.caption
    }
  }

  component ModelRow: Item {
    id: modelRow
    property var row: null
    property real share: 0

    implicitHeight: modelName.implicitHeight + Style.spacing.lg

    Rectangle {
      anchors.fill: parent
      radius: Style.cornerRadius
      color: root.alpha(root.foreground, 0.05)
    }

    Rectangle {
      anchors.left: parent.left
      anchors.top: parent.top
      anchors.bottom: parent.bottom
      width: parent.width * root.clamp(modelRow.share, 0, 1)
      radius: Style.cornerRadius
      color: root.alpha(root.foreground, 0.14)

      Behavior on width {
        NumberAnimation { duration: 160; easing.type: Easing.OutCubic }
      }
    }

    Text {
      id: modelName
      textFormat: Text.PlainText
      text: modelRow.row ? modelRow.row.name : ""
      color: root.foreground
      font.family: root.fontFamily
      font.pixelSize: Style.font.bodySmall
      elide: Text.ElideRight
      anchors.left: parent.left
      anchors.leftMargin: Style.space(8)
      anchors.right: modelTokens.left
      anchors.rightMargin: Style.space(8)
      anchors.verticalCenter: parent.verticalCenter
    }

    Text {
      id: modelTokens
      textFormat: Text.PlainText
      text: modelRow.row ? Model.formatTokenCount(modelRow.row.total) : ""
      color: root.dim
      font.family: root.fontFamily
      font.pixelSize: Style.font.bodySmall
      font.bold: true
      anchors.right: parent.right
      anchors.rightMargin: Style.space(8)
      anchors.verticalCenter: parent.verticalCenter
    }

    MouseArea {
      id: modelHover
      anchors.fill: parent
      hoverEnabled: true
      acceptedButtons: Qt.NoButton
    }

    PanelToolTip {
      visible: modelHover.containsMouse
      text: root.modelTooltip(modelRow.row)
      fontFamily: root.fontFamily
    }
  }

  component SessionRow: CursorSurface {
    id: row

    property var session: ({})
    readonly property string sessionId: session && session.id ? session.id : ""
    readonly property int flatIndex: {
      for (var i = 0; i < root.rows.length; i++) {
        if (root.rows[i].id === sessionId) return i
      }
      return -1
    }

    hasCursor: root.cursorActive && root.selectedSession && root.selectedSession.id === sessionId
    foreground: root.foreground
    implicitHeight: labels.implicitHeight + Style.space(12)

    onHasCursorChanged: if (hasCursor && root.keyboardMoving) root.scrollItemIntoView(row)

    MouseArea {
      anchors.fill: parent
      hoverEnabled: true
      cursorShape: Qt.PointingHandCursor
      onEntered: if (row.flatIndex >= 0 && !scrollReset.running && !scrollResetFollowup.running)
        root.setSessionCursor(row.flatIndex)
      onClicked: root.attachSession(row.session)
    }

    RowLayout {
      id: body
      anchors.left: parent.left
      anchors.right: parent.right
      anchors.verticalCenter: parent.verticalCenter
      anchors.leftMargin: Style.space(10)
      anchors.rightMargin: Style.space(10)
      spacing: Style.space(8)

      Text {
        textFormat: Text.PlainText
        text: root.statusMark(row.session.status)
        color: root.statusColor(row.session.status)
        font.family: root.fontFamily
        font.pixelSize: Style.font.body
        Layout.alignment: Qt.AlignVCenter
      }

      ColumnLayout {
        id: labels
        Layout.fillWidth: true
        spacing: Style.space(1)

        Text {
          Layout.fillWidth: true
          textFormat: Text.PlainText
          text: row.session.title || "Untitled session"
          color: root.foreground
          font.family: root.fontFamily
          font.pixelSize: Style.font.body
          elide: Text.ElideRight
        }

        Text {
          Layout.fillWidth: true
          textFormat: Text.PlainText
          text: root.rowMeta(row.session)
          color: root.dim
          font.family: root.fontFamily
          font.pixelSize: Style.font.caption
          elide: Text.ElideRight
        }
      }

      Text {
        visible: row.session.status === "running"
        textFormat: Text.PlainText
        text: "LIVE"
        color: root.urgent
        font.family: root.fontFamily
        font.pixelSize: Style.font.caption
        font.bold: true
        Layout.alignment: Qt.AlignVCenter
      }
    }
  }
}
