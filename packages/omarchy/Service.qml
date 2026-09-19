import QtQuick
import Quickshell
import Quickshell.Io
import "Model.js" as Model

Item {
  id: root
  visible: false

  property var settings: ({})
  property bool opened: false
  property double nowMs: Date.now()

  property bool online: false
  property bool refreshing: false
  property var sessions: []
  property var active: ({})
  property var grouped: []
  property var latest: []
  property var flat: []
  property var usage: ({ cost: 0, tokens: ({}), totalTokens: 0, models: [], sessions: 0 })
  property var goLimits: []
  property int runningCount: 0
  property int unreadCount: 0
  property int totalCount: 0

  readonly property int refreshIntervalSec: Math.max(2, Math.min(60, parseInt(String(setting("refreshIntervalSec", 4)), 10) || 4))
  readonly property int sessionLimit: Math.max(5, Math.min(50, parseInt(String(setting("sessionLimit", 20)), 10) || 20))

  function setting(name, fallback) {
    var value = settings ? settings[name] : undefined
    return value === undefined || value === null ? fallback : value
  }

  function scriptPath() {
    var url = Qt.resolvedUrl("fetch.ts").toString()
    if (url.indexOf("file://") === 0) return decodeURIComponent(url.slice(7))
    return url
  }

  function applySnapshot(raw) {
    var parsed = Model.parseSnapshot(raw)
    if (!parsed.ok) {
      if ((parsed.error || "offline") === "offline") {
        online = false
        sessions = []
        active = ({})
        goLimits = []
        usage = Model.emptyUsage()
        rebuild()
      }
      return
    }

    online = true
    sessions = parsed.sessions
    active = parsed.active
    goLimits = parsed.goLimits
    usage = Model.usageFromStats(parsed.stats)
    rebuild()
  }

  function rebuild() {
    var nextCounts = Model.counts(sessions, active)
    runningCount = nextCounts.running
    unreadCount = nextCounts.unread
    totalCount = nextCounts.total
    grouped = Model.groups(sessions, active, nowMs)
    latest = Model.latest(sessions, active, nowMs)
    flat = Model.flatten(grouped)
  }

  function refresh() {
    if (fetchProcess.running) return
    refreshing = true
    fetchProcess.command = ["bun", scriptPath(), String(sessionLimit)]
    fetchProcess.running = true
  }

  function tickAges() {
    nowMs = Date.now()
    if (online) rebuild()
  }

  Process {
    id: fetchProcess
    running: false
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        root.applySnapshot(text)
        root.refreshing = false
      }
    }
    onExited: function(exitCode) {
      if (exitCode !== 0 && root.refreshing) {
        root.online = false
        root.refreshing = false
      }
    }
  }

  Timer {
    interval: root.refreshIntervalSec * 1000
    running: true
    repeat: true
    triggeredOnStart: true
    onTriggered: root.refresh()
  }

  Timer {
    interval: 30000
    running: root.opened && root.online
    repeat: true
    onTriggered: root.tickAges()
  }

  Component.onCompleted: refresh()
}
