--!strict
-- TS `src/grouping.ts`: sessions grouped by directory, project or time, as a tree of subsessions, flattened to the
-- page's rows, and filtered by a search. Dates are read in the local time zone (`os.date`), as TS's.
local grouping = {}

grouping.MODES = { "directory", "project", "created", "updated", "viewed" }

export type Session = {
    id: string,
    parentID: string?,
    projectID: string,
    title: string?,
    time: { created: number, updated: number, viewed: number? },
    location: { directory: string },
}

-- TS `titleOf`.
function grouping.title(session: Session): string
    local title = session.title and session.title:match("^%s*(.-)%s*$")
    return if title and title ~= "" then title else session.id
end

-- TS `sortTime`.
function grouping.time(session: Session, mode: string): number
    if mode == "created" then
        return session.time.created
    elseif mode == "viewed" then
        return session.time.viewed or session.time.updated
    end
    return session.time.updated
end

local DAY = 86_400_000

-- TS `timeBucket`'s index: today, yesterday, the last 7 days, the last 30, earlier; days start at local midnight.
function grouping.bucket(time: number, now: number): number
    local date = os.date("*t", now // 1000) :: any
    date.hour, date.min, date.sec = 0, 0, 0
    local today = os.time(date) * 1000
    for index, start in { today, today - DAY, today - 6 * DAY, today - 29 * DAY } do
        if time >= start then
            return index
        end
    end
    return 5
end

-- TS `formatAge`: `just now`, `5m ago`, `3h ago`, `2d ago`, else the local date.
function grouping.age(time: number, now: number, t): string
    local minutes = math.max(0, now - time) // 60_000
    local hours, days = minutes // 60, minutes // 60 // 24
    if minutes < 1 then
        return t.now
    elseif minutes < 60 then
        return t.minutes(minutes)
    elseif hours < 24 then
        return t.hours(hours)
    elseif days < 30 then
        return t.days(days)
    end
    return os.date("%Y-%m-%d", time // 1000) :: string
end

local function countNodes(nodes): number
    local total = 0
    for _, node in nodes do
        total += 1 + countNodes(node.children)
    end
    return total
end

-- TS `buildGroups`: groups of trees, each sorted newest first, the groups by their newest session or by bucket.
function grouping.groups(sessions: { Session }, mode: string, children: boolean, now: number, label: (string) -> string)
    local ids = {}
    for _, session in sessions do
        ids[session.id] = true
    end
    local function isRoot(session: Session): boolean
        return not session.parentID or not ids[session.parentID]
    end
    -- Stable, as JavaScript's sort: equal times keep their order.
    local function sorted(list)
        local order = {}
        for index, node in list do
            order[node] = index
        end
        table.sort(list, function(a, b)
            local ta, tb = grouping.time(a.session, mode), grouping.time(b.session, mode)
            if ta ~= tb then
                return ta > tb
            end
            return order[a] < order[b]
        end)
    end
    local nodes = {}
    for _, session in sessions do
        nodes[session.id] = { session = session, children = {} }
    end
    if children then
        for _, session in sessions do
            if not isRoot(session) then
                table.insert(nodes[session.parentID :: string].children, nodes[session.id])
            end
        end
        for _, node in nodes do
            sorted(node.children)
        end
    end
    local groups, byKey = {}, {}
    for _, session in sessions do
        if isRoot(session) then
            local key = if mode == "directory"
                then session.location.directory
                elseif mode == "project" then session.projectID
                else tostring(grouping.bucket(grouping.time(session, mode), now))
            local group = byKey[key]
            if not group then
                group = { key = key, roots = {}, index = #groups + 1 }
                byKey[key] = group
                table.insert(groups, group)
            end
            table.insert(group.roots, nodes[session.id])
        end
    end
    for _, group in groups do
        sorted(group.roots)
        group.label = label(group.key)
        group.count = countNodes(group.roots)
    end
    local function latest(group): number
        local most = -math.huge
        for _, node in group.roots do
            most = math.max(most, node.session.time.updated)
        end
        return most
    end
    table.sort(groups, function(a, b)
        local ka, kb
        if mode == "directory" or mode == "project" then
            ka, kb = -latest(a), -latest(b)
        else
            ka, kb = tonumber(a.key) :: number, tonumber(b.key) :: number
        end
        if ka ~= kb then
            return ka < kb
        end
        return a.index < b.index
    end)
    return groups
end

-- TS `flattenRows`: each group's row, then, unless it is folded, its sessions as a tree.
function grouping.rows(groups, collapsed: { [string]: boolean })
    local rows = {}
    local function walk(group, node, depth: number, indent: string, last: boolean)
        local prefix = if depth == 0 then "" else indent .. (if last then "└─ " else "├─ ")
        table.insert(rows, { type = "session", session = node.session, group = group, depth = depth, prefix = prefix })
        local inner = if depth == 0 then "" else indent .. (if last then "   " else "│  ")
        for index, child in node.children do
            walk(group, child, depth + 1, inner, index == #node.children)
        end
    end
    for _, group in groups do
        local folded = collapsed[group.key] == true
        table.insert(rows, { type = "group", group = group, collapsed = folded })
        if not folded then
            for _, root in group.roots do
                walk(group, root, 0, "", true)
            end
        end
    end
    return rows
end

-- TS `filterSessions`: the sessions matching every word of `query`, with the ancestors of a matching subsession when
-- `children`; else only top-level sessions are searched.
function grouping.filter(sessions: { Session }, query: string, text: (Session) -> string, children: boolean): { Session }
    local terms = {}
    for term in query:lower():gmatch("%S+") do
        table.insert(terms, term)
    end
    if #terms == 0 then
        return sessions
    end
    local byID = {}
    for _, session in sessions do
        byID[session.id] = session
    end
    local keep = {}
    for _, session in sessions do
        local root = not session.parentID or not byID[session.parentID]
        if children or root then
            local haystack = text(session):lower()
            local matches = true
            for _, term in terms do
                if not haystack:find(term, 1, true) then
                    matches = false
                    break
                end
            end
            local cursor: Session? = if matches then session else nil
            while cursor and not keep[cursor.id] do
                keep[cursor.id] = true
                cursor = cursor.parentID and byID[cursor.parentID]
            end
        end
    end
    local kept = {}
    for _, session in sessions do
        if keep[session.id] then
            table.insert(kept, session)
        end
    end
    return kept
end

-- TS `countWithDescendants`.
function grouping.withDescendants(ids: { string }, sessions: { Session }): number
    local children = {}
    for _, session in sessions do
        if session.parentID then
            children[session.parentID] = children[session.parentID] or {}
            table.insert(children[session.parentID], session.id)
        end
    end
    local function descendants(id: string): number
        local total = 0
        for _, child in children[id] or {} do
            total += 1 + descendants(child)
        end
        return total
    end
    local total = 0
    for _, id in ids do
        total += 1 + descendants(id)
    end
    return total
end

return table.freeze(grouping)
