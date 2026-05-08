--------------------------------------------------------------------------------
-- Helpers to add multi-character flags to an argmatcher.
--
-- This makes it easy to add flags like `dir /o:nge` and be able to provide
-- completions on the fly even after `dir /o:ng` has been typed.
--
--      local mcf = require('multicharflags')
--
--      local sortflags = clink.argmatcher()
--      mcf.addcharflagsarg(sortflags, {
--          { 'n',  'By name (alphabetic)' },
--          { 'e',  'By extension (alphabetic)' },
--          { 'g',  'Group directories first' },
--          { 's',  'By size (smallest first)' },
--          { 'd',  'By name (alphabetic)' },
--          { '-',  'Prefix to reverse order' },
--      })
--      clink.argmatcher('dir'):addflags('/o:'..sortflags)
--
-- The exported functions are:
--
--      local mcf = require('multicharflags')
--
--      mcf.addcharflagsarg(argmatcher, chars_table)
--          This adds an arg to argmatcher, for the character flags listed in
--          chars_table (each table element is a sub-table with two fields, the
--          character and its description).  It returns argmatcher.
--
--      mcf.setcharflagsclassifier(argmatcher, chars_table)
--          This makes and sets a classifier for the character flags.  This is
--          for specialized scenarios, and is not normally needed because
--          addcharflagsarg() automatically does this.
--
--      mcf.makecharflagsclassifier(chars_table)
--          Makes a character flags classifier.  This is for specialized
--          scenarios, and is not normally needed because addcharflagsarg()
--          automatically does this.

if not clink then
    -- E.g. some unit test systems will run this module *outside* of Clink.
    return
end

--------------------------------------------------------------------------------
local function index_chars_table(t)
    if not t.indexed then
        if t.caseless then
            for _, m in ipairs(t) do
                t[m[1]:lower()] = true
                t[m[1]:upper()] = true
            end
        else
            for _, m in ipairs(t) do
                t[m[1]] = true
            end
        end
        t.indexed = true
    end
end

local function compound_matches_func(chars, word,   -- luacheck: no unused args, no unused
        word_index, line_state, builder, user_data) -- luacheck: no unused
    local info = line_state:getwordinfo(word_index)
    if not info then
        return {}
    end

    -- local used = {}
    local available = {}

    if chars.caseless then
        for _, m in ipairs(chars) do
            available[m[1]:lower()] = true
            available[m[1]:upper()] = true
        end
    else
        for _, m in ipairs(chars) do
            available[m[1]] = true
        end
    end

    word = line_state:getline():sub(info.offset, line_state:getcursor() - 1)

    for _, m in ipairs(chars) do
        if chars.caseless then
            local l = m[1]:lower()
            local u = m[1]:upper()
            if word:find(l, 1, true--[[plain]]) or word:find(u, 1, true--[[plain]]) then
                -- used[l] = true
                -- used[u] = true
                available[l] = false
                available[u] = false
            end
        else
            local c = m[1]
            if word:find(c, 1, true--[[plain]]) then
                -- used[c] = true
                available[c] = false
            end
        end
    end

    local last_c
    if #word > 0 then
        last_c = word:sub(-1)
    else
        last_c = line_state:getline():sub(info.offset - 1, info.offset - 1)
    end
    available['+'] = chars['+'] and last_c ~= '+' and last_c ~= '-'
    available['-'] = chars['-'] and last_c ~= '+' and last_c ~= '-'

    local matches = { nosort=true }
    for _, m in ipairs(chars) do
        local c = m[1]
        if available[c] then
            table.insert(matches, { match=word..c, display='\x1b[m'..c, description=m[2], suppressappend=true })
        end
    end

    if builder.setvolatile then
        builder:setvolatile()
    elseif clink._reset_generate_matches then
        clink._reset_generate_matches()
    end

    return matches
end

local function get_bad_color()
    local bad = settings.get('color.unrecognized')
    if not bad or bad == '' then
        bad = '91'
    end
    return bad
end

local function compound_classifier(chars, arg_index,    -- luacheck: no unused args
        word, word_index, line_state, classifications)
    local info = line_state:getwordinfo(word_index)
    if not info then
        return
    end

    local bad
    local good = settings.get('color.arg')

    for i = 1, #word do
        local c = word:sub(i, i)
        if chars[c] then
            classifications:applycolor(info.offset + i - 1, 1, good)
        else
            bad = bad or get_bad_color()
            classifications:applycolor(info.offset + i - 1, 1, bad)
        end
    end

    if chars['+'] then
        local plus_pos = info.offset + info.length
        if line_state:getline():sub(plus_pos, plus_pos) == '+' then
            classifications:applycolor(plus_pos, 1, good)
        end
    end
end

local function make_char_flags_classifier(chars)
    local function classifier_func(...)
        compound_classifier(chars, ...)
    end
    return classifier_func
end

local function set_char_flags_classifier(argmatcher, chars)
    if argmatcher.setclassifier then
        argmatcher:setclassifier(make_char_flags_classifier(chars))
    end
    return argmatcher
end

local function add_char_flags_arg(argmatcher, chars, ...)
    index_chars_table(chars)

    local matches_func = function (...)
        return compound_matches_func(chars, ...)
    end

    local t = { matches_func }
    if chars['+'] then
        t.loopchars = '+'
    end

    argmatcher:addarg(t, ...)
    set_char_flags_classifier(argmatcher, chars)

    return argmatcher
end

--------------------------------------------------------------------------------
return {
    addcharflagsarg = add_char_flags_arg,
    makecharflagsclassifier = make_char_flags_classifier,
    setcharflagsclassifier = set_char_flags_classifier,
}
