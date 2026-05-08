local exports = {}

local w = require('tables').wrap
local clink_version = require('clink_version')

local function isdir(name)
    return clink_version.new_api and os.isdir(name) or clink.is_dir(name)
end

exports.list_files = function (base_path, glob, recursive, reverse_separator)
    local mask = glob or '/*'

    local entries = w(clink.find_files(base_path..mask))
    :filter(function(entry)
        return exports.is_real_dir(entry)
    end)

    local files = entries:filter(function(entry)
        return not isdir(base_path..'/'..entry)
    end)

    -- if 'recursive' flag is not set, we don't need to iterate
    -- through directories, so just return files found
    if not recursive then return files end

    local sep = reverse_separator and '/' or '\\'

    return entries
    :filter(function(entry)
        return isdir(base_path..'/'..entry)
    end)
    :reduce(files, function(accum, dir)
        -- iterate through directories and call list_files recursively
        return exports.list_files(base_path..'/'..dir, mask, recursive, reverse_separator)
        :map(function(entry)
            return dir..sep..entry
        end)
        :concat(accum)
    end)
end

exports.basename = function (pathname)
    local prefix = pathname
    if clink_version.supports_path_toparent then
        prefix = path.getname(pathname)
    else
        local i = pathname:find("[\\/:][^\\/:]*$")
        if i then
            prefix = pathname:sub(i + 1)
        end
    end
    return prefix
end

exports.pathname = function (pathname)
    local prefix = ""
    if clink_version.supports_path_toparent then
        -- Clink v1.1.20 and higher provide an API to do this right.
        local child
        prefix,child = path.toparent(pathname)
        if child == "" then
            -- This means it can't go up further.  The old implementation
            -- returned "" in that case, though no callers stopped when an
            -- empty path was returned; they only stopped when the
            -- returned path equaled the input path.
            prefix = ""
        end
    else
        -- This approach has several bugs. For example, "c:/" yields "c".
        -- Walking up looking for .git tries "c:/.git" and then "c/.git".
        local i = pathname:find("[\\/:][^\\/:]*$")
        if i then
            prefix = pathname:sub(1, i-1)
        end
    end
    return prefix
end

exports.is_absolute = function (pathname)
    local drive = pathname:find("^%s?[%l%a]:[\\/]")
    if drive then return true else return false end
end

exports.is_metadir = function (dirname)
    return exports.basename(dirname) == '.'
        or exports.basename(dirname) == '..'
end

exports.is_real_dir = function (dirname)
    return not exports.is_metadir(dirname)
end

return exports
