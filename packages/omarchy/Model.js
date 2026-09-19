function asArray(value) {
  if (!value) return []
  if (Array.isArray(value)) return value.slice()
  var length = Number(value.length || 0)
  if (!isFinite(length) || length <= 0) return []
  var list = []
  for (var i = 0; i < length; i++) list.push(value[i])
  return list
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {}
}

function sessionId(session) {
  return session ? String(session.id || "") : ""
}

function directoryOf(session) {
  if (!session) return ""
  var location = asObject(session.location)
  return String(location.directory || "")
}

function projectLabel(session) {
  var directory = directoryOf(session)
  if (directory === "") return "Unknown project"
  var parts = directory.split("/")
  for (var i = parts.length - 1; i >= 0; i--) {
    if (parts[i] !== "") return parts[i]
  }
  return directory
}

function modelLabel(session) {
  var model = session ? session.model : null
  if (!model || typeof model !== "object") return ""
  return String(model.id || "")
}

function titleOf(session) {
  var title = session ? String(session.title || "").trim() : ""
  return title !== "" ? title : "Untitled session"
}

function updatedMs(session) {
  var time = session && session.time ? session.time : null
  var value = time ? Number(time.updated || time.created || 0) : 0
  return isFinite(value) ? value : 0
}

function isRunning(session, active) {
  var id = sessionId(session)
  if (id === "") return false
  var entry = asObject(active)[id]
  return !!(entry && entry.type === "running")
}

function isUnread(session) {
  if (!session || !session.time) return false
  var idle = Number(session.time.idle || 0)
  if (!(idle > 0)) return false
  var viewed = session.time.viewed
  if (viewed === undefined || viewed === null) return true
  return Number(viewed) < idle
}

function statusOf(session, active) {
  if (isRunning(session, active)) return "running"
  if (isUnread(session)) return "unread"
  var outcome = session ? String(session.outcome || "") : ""
  if (outcome === "failed" || outcome === "interrupted") return outcome
  return "idle"
}

function statusLabel(status) {
  if (status === "running") return "Running"
  if (status === "unread") return "Needs attention"
  if (status === "failed") return "Failed"
  if (status === "interrupted") return "Interrupted"
  return "Idle"
}

function formatAge(ms, nowMs) {
  var age = Number(nowMs) - Number(ms)
  if (!isFinite(age) || age < 0) age = 0
  var minutes = Math.floor(age / 60000)
  if (minutes < 1) return "now"
  if (minutes < 60) return minutes + "m"
  var hours = Math.floor(minutes / 60)
  if (hours < 24) return hours + "h"
  return Math.floor(hours / 24) + "d"
}

function decorate(session, active, nowMs) {
  var status = statusOf(session, active)
  return {
    id: sessionId(session),
    title: titleOf(session),
    project: projectLabel(session),
    directory: directoryOf(session),
    model: modelLabel(session),
    agent: session ? String(session.agent || "") : "",
    status: status,
    statusLabel: statusLabel(status),
    outcome: session ? String(session.outcome || "") : "",
    age: formatAge(updatedMs(session), nowMs),
    updated: updatedMs(session),
    running: status === "running",
    unread: status === "unread"
  }
}

function decorateAll(sessions, active, nowMs) {
  var decorated = []
  var list = asArray(sessions)
  for (var i = 0; i < list.length; i++) {
    var row = decorate(list[i], active, nowMs)
    if (row.id !== "") decorated.push(row)
  }
  return decorated
}

function latest(sessions, active, nowMs) {
  var decorated = decorateAll(sessions, active, nowMs)
  decorated.sort(function(a, b) { return b.updated - a.updated })
  return decorated
}

function compareDecorated(a, b) {
  if (a.running !== b.running) return a.running ? -1 : 1
  if (a.unread !== b.unread) return a.unread ? -1 : 1
  return b.updated - a.updated
}

function groups(sessions, active, nowMs) {
  var decorated = decorateAll(sessions, active, nowMs)
  decorated.sort(compareDecorated)

  var order = []
  var byProject = {}
  for (var j = 0; j < decorated.length; j++) {
    var item = decorated[j]
    var key = item.directory || item.project
    if (!byProject[key]) {
      byProject[key] = { label: item.project, sessions: [] }
      order.push(key)
    }
    byProject[key].sessions.push(item)
  }

  var result = []
  for (var k = 0; k < order.length; k++) result.push(byProject[order[k]])
  return result
}

function counts(sessions, active) {
  var running = 0
  var unread = 0
  var list = asArray(sessions)
  for (var i = 0; i < list.length; i++) {
    if (isRunning(list[i], active)) running++
    else if (isUnread(list[i])) unread++
  }
  return { running: running, unread: unread, total: list.length }
}

function flatten(grouped) {
  var rows = []
  var list = asArray(grouped)
  for (var i = 0; i < list.length; i++) {
    var sessions = asArray(list[i].sessions)
    for (var j = 0; j < sessions.length; j++) rows.push(sessions[j])
  }
  return rows
}

function tokenParts(tokens) {
  var value = asObject(tokens)
  var cache = asObject(value.cache)
  return {
    input: Number(value.input || 0),
    output: Number(value.output || 0),
    reasoning: Number(value.reasoning || 0),
    cacheRead: Number(cache.read || 0),
    cacheWrite: Number(cache.write || 0)
  }
}

function tokenTotal(parts) {
  return parts.input + parts.output + parts.reasoning + parts.cacheRead + parts.cacheWrite
}

function formatTokenCount(n) {
  var value = Number(n)
  if (!isFinite(value) || value <= 0) return "0"
  if (value >= 1e9) return (value / 1e9).toFixed(1) + "B"
  if (value >= 1e6) return (value / 1e6).toFixed(1) + "M"
  if (value >= 1e3) return (value / 1e3).toFixed(1) + "K"
  return String(Math.round(value))
}

function formatMoney(value) {
  var amount = Number(value)
  if (!isFinite(amount)) amount = 0
  return "$" + amount.toFixed(2)
}

function emptyUsage() {
  return { cost: 0, tokens: ({ input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }), totalTokens: 0, models: [], sessions: 0 }
}

function modelNameFromStats(row) {
  var model = asObject(row && row.model)
  var name = String(model.id || "")
  return name !== "" ? name : "Unknown"
}

function usageFromStats(stats) {
  if (!stats) return emptyUsage()
  var data = asObject(stats)
  var parts = tokenParts(data.tokens)
  var models = asArray(data.models).map(function(row) {
    var tokens = tokenParts(row.tokens)
    return {
      name: modelNameFromStats(row),
      total: tokenTotal(tokens),
      cost: Number(row.cost || 0),
      input: tokens.input,
      output: tokens.output,
      reasoning: tokens.reasoning,
      cacheRead: tokens.cacheRead,
      cacheWrite: tokens.cacheWrite
    }
  })
  models.sort(function(a, b) { return b.cost - a.cost })
  return {
    cost: Number(data.cost || 0),
    tokens: parts,
    totalTokens: tokenTotal(parts),
    models: models.slice(0, 4),
    sessions: Number(data.sessions || 0)
  }
}

function parseSnapshot(raw) {
  try {
    var parsed = JSON.parse(String(raw || ""))
    if (!parsed || typeof parsed !== "object") return { ok: false, error: "offline" }
    if (parsed.ok !== true) return { ok: false, error: String(parsed.error || "offline") }
    var go = parsed.go && typeof parsed.go === "object" ? parsed.go : null
    var stats = parsed.stats && typeof parsed.stats === "object" ? parsed.stats : null
    return {
      ok: true,
      url: String(parsed.url || ""),
      sessions: asArray(parsed.sessions),
      active: asObject(parsed.active),
      goLimits: go ? asArray(go.limits) : [],
      stats: stats
    }
  } catch (e) {
    return { ok: false, error: "offline" }
  }
}
