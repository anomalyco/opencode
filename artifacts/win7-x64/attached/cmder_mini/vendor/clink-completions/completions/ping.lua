require('arghelper')
local w = require('tables').wrap
local clink_version = require('clink_version')

-- Hosts from the .ssh/config file use `color.alias`.
-- Hosts from the .ssh/known_hosts use `color.cmd`.
-- Hosts from the hosts file use default color.

local arg = clink.argmatcher():addarg()
local host_list = clink.argmatcher():addarg({fromhistory=true})
local src_addr = clink.argmatcher():addarg({fromhistory=true})

local function read_lines (filename)
    local lines = w({})
    local f = io.open(filename)
    if not f then
        return lines
    end

    for line in f:lines() do
        table.insert(lines, line)
    end

    f:close()
    return lines
end

local function extract_address(pattern, match_type, portflag)
    if not pattern then
        return nil
    end

    local addr, port = pattern:match('%[([^%]]+)%]:(%d+)')
    if not addr then
        addr = pattern:match('%[([^%]]+)%]')
    end
    if not addr then
        addr = pattern
    end

    local match
    if portflag and port then
        match = addr .. portflag .. port
    else
        match = addr
    end
    if clink_version.supports_display_filter_description then
        return { match=match, type=match_type }
    else
        return match
    end
end

-- read all Host entries in the user's ssh config file
local function list_ssh_hosts(portflag)
    local matches = w({})
    local lines = read_lines(clink.get_env("userprofile") .. "/.ssh/config")
    for _, line in ipairs(lines) do
        line = line:gsub('(#.*)$', '')
        local host = line:match('^Host%s+(.*)$')
        if host then
            for pattern in host:gmatch('([^%s]+)') do
                if not pattern:match('[%*%?/!]') then
                    table.insert(matches, extract_address(pattern, 'alias', portflag))
                end
            end
        end
    end
    return matches:filter()
end

local function list_known_hosts(portflag)
    return read_lines(clink.get_env("userprofile") .. "/.ssh/known_hosts")
        :map(function (line)
            line = line:gsub('(#.*)$', '')
            return extract_address(line:match('^([^%s,]*).*'), 'cmd', portflag)
        end)
        :filter()
end

local function list_hosts_file()
    local t = w({})
    local lines = read_lines(os.getenv("systemroot") .. "/system32/drivers/etc/hosts")
    for _, line in ipairs(lines) do
        line = line:gsub('(#.*)$', '')
        local ip, hosts = line:match('^%s*([0-9.:]+)%s(.*)$')
        if ip then
            table.insert(t, ip)
            for _, host in ipairs(string.explode(hosts)) do
                table.insert(t, host)
            end
        end
    end
    return t:filter()
end

local function hosts(token)  -- luacheck: no unused args
    return list_ssh_hosts()
        :concat(list_known_hosts())
        :concat(list_hosts_file())
end

-- luacheck: no max line length
clink.argmatcher("ping")
:addarg({hosts})
:_addexflags({
    {"-t",                  "Ping the specified host until stopped"},
    {"-a",                  "Resolve addresses to hostnames"},
    {"-n"..arg, " count",   "Number of echo requests to send"},
    {"-l"..arg, " size",    "Send buffer size"},
    {"-f",                  "Set Don't Fragment flag in packet (IPv4-only)"},
    {"-i"..arg, " TTL",     "Time To Live"},
    {"-v"..arg, " TOS",     "Deprecated; Type of Service (IPv4-only)"},
    {"-r"..arg, " count",   "Record route for count hops (IPv4-only)"},
    {"-s"..arg, " count",   "Timestamp for count hops (IPv4-only)"},
    {"-j"..host_list, " host-list", "Loose source route along host-list (IPv4-only)"},
    {"-k"..host_list, " host-list", "Strict source route along host-list (IPv4-only)"},
    {"-w"..arg, " timeout", "Timeout in milliseconds to wait for each reply"},
    {"-R",                  "Deprecated; Use routing header to test reverse route also (IPv4-only)"},
    {"-S"..src_addr, " srcaddr", "Source address to use"},
    {"-c"..arg, " compartment", "Routing compartment identifier"},
    {"-p",                  "Ping a Hyper-V Network Virtualization provider address"},
    {"-4",                  "Force using IPv4"},
    {"-6",                  "Force using IPv6"},
})

