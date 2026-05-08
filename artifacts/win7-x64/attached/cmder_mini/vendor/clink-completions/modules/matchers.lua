local clink_version = require('clink_version')

local exports = {}

local path = require('path')
local w = require('tables').wrap

-- A function to generate directory matches.
--
--  local matchers = require("matchers")
--  clink.argmatcher():addarg(matchers.dirs)
exports.dirs = function(word)
    -- Strip off any path components that may be on text.
    local prefix = ""
    local i = word:find("[\\/:][^\\/:]*$")
    if i then
        prefix = word:sub(1, i)
    end
    local include_dots = word:find("%.+$") ~= nil

    -- Find matches.
    local matches = w(clink.find_dirs(word.."*", true))
    :filter(function (dir)
        return clink.is_match(word, prefix..dir) and
            (include_dots or path.is_real_dir(dir))
    end)
    :map(function(dir)
        return prefix..dir
    end)

    -- If there was no matches but word is a dir then use it as the single match.
    -- Otherwise tell readline that matches are files and it will do magic.
    if #matches == 0 and clink.is_dir(rl_state.text) then
        return {rl_state.text}
    end

    clink.matches_are_files()
    return matches
end

-- A function to generate file matches.
--
--  local matchers = require("matchers")
--  clink.argmatcher():addarg(matchers.files)
exports.files = function (word)
    if clink_version.supports_display_filter_description then
        local matches = w(clink.filematches(word))
        return matches
    end

    -- Strip off any path components that may be on text.
    local prefix = ""
    local i = word:find("[\\/:][^\\/:]*$")
    if i then
        prefix = word:sub(1, i)
    end

    -- Find matches.
    local matches = w(clink.find_files(word.."*", true))
    :filter(function (file)
        return clink.is_match(word, prefix..file)
    end)
    :map(function(file)
        return prefix..file
    end)

    -- Tell readline that matches are files and it will do magic.
    if #matches ~= 0 then
        clink.matches_are_files()
    end

    return matches
end

-- Returns a function that generates matches for the specified wildcards.
--
--  local matchers = require("matchers")
--  clink.argmatcher():addarg(matchers.ext_files("*.json"))
exports.ext_files = function (...)
    local wildcards = {...}

    if clink.argmatcher then
        return function (word)
            local matches = clink.dirmatches(word.."*")
            for _, wild in ipairs(wildcards) do
                for _, m in ipairs(clink.filematches(word..wild)) do
                    table.insert(matches, m)
                end
            end
            return matches
        end
    end

    return function (word)

        -- Strip off any path components that may be on text.
        local prefix = ""
        local i = word:find("[\\/:][^\\/:]*$")
        if i then
            prefix = word:sub(1, i)
        end

        -- Find directories.
        local matches = w(clink.find_dirs(word.."*", true))
        :filter(function (dir)
            return clink.is_match(word, prefix..dir) and path.is_real_dir(dir)
        end)
        :map(function(dir)
            return prefix..dir
        end)

        -- Find wildcard matches (e.g. *.dll).
        for _, wild in ipairs(wildcards) do
            local filematches = w(clink.find_files(word..wild, true))
            :filter(function (file)
                return clink.is_match(word, prefix..file)
            end)
            :map(function(file)
                return prefix..file
            end)
            matches = matches:concat(filematches)
        end

        -- Tell readline that matches are files and it will do magic.
        if #matches ~= 0 then
            clink.matches_are_files()
        end

        return matches
    end
end

exports.create_dirs_matcher = function (dir_pattern, show_dotfiles)
    return function (token)
        return w(clink.find_dirs(dir_pattern))
        :filter(function(dir)
            return clink.is_match(token, dir) and (path.is_real_dir(dir) or show_dotfiles)
        end )
    end
end

exports.create_files_matcher = function (file_pattern)
    return function (token)
        return w(clink.find_files(file_pattern))
        :filter(function(file)
            -- Filter out '.' and '..' entries as well
            return clink.is_match(token, file) and path.is_real_dir(file)
        end )
    end
end

return exports
