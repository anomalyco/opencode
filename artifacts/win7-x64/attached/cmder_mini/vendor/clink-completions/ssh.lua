-- Some modifications added based on:
-- https://github.com/dodmi/Clink-Addons

local clink_version = require('clink_version')

local w = require('tables').wrap
local parser = clink.arg.new_parser

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

local function match_display_filter(matches)
    for i, v in ipairs(matches) do
        matches[i] = v:gsub('( %-p )', '\027[39m%1')
    end
    return matches
end

local function ondisplaymatches(matches)
    local new_matches = {}
    for _,m in ipairs(matches) do
        m.display = m.match:gsub('( %-p )', '\027[39m%1')
        table.insert(new_matches, m)
    end
    return new_matches
end

local function hosts_with_port_flag(token)  -- luacheck: no unused args
    if clink_version.supports_display_filter_description then
        clink.ondisplaymatches(ondisplaymatches)
    else
        clink.match_display_filter = match_display_filter
    end
    return list_ssh_hosts(' -p ')
        :concat(list_known_hosts(' -p '))
end

local function hosts_with_port(token)  -- luacheck: no unused args
    if clink_version.supports_display_filter_description then
        clink.ondisplaymatches(ondisplaymatches)
    else
        clink.match_display_filter = match_display_filter
    end
    return list_ssh_hosts(':')
        :concat(list_known_hosts(':'))
end

local function hosts(token)  -- luacheck: no unused args, no unused
    return list_ssh_hosts()
        :concat(list_known_hosts())
end

-- return the list of available local ips
local function localIPs(token) -- luacheck: no unused args
    local assignedIPs = {}
    local f = io.popen('2>nul wmic nicconfig list IP')
    if f then
        local netLine
        for line in f:lines() do
            netLine = line:match('%{(.*)%}')
            if netLine then
                for ip in netLine:gmatch('%"([^,%s]*)%"') do
                    table.insert(assignedIPs, ip)
                end
            end
        end
        f:close()
    end
    return assignedIPs
end

-- return the list of supported ciphers
local function supportedCiphers(token) -- luacheck: no unused args
    local ciphers = {}
    local f = io.popen('2>nul ssh -Q cipher')
    if f then
        for line in f:lines() do
            table.insert(ciphers, line)
        end
        f:close()
    end
    return ciphers
end

-- return the list of supported MACs
local function supportedMACs(token) -- luacheck: no unused args
    local macs = {}
    local f = io.popen('2>nul ssh -Q mac')
    if f then
        for line in f:lines() do
            table.insert(macs, line)
        end
        f:close()
    end
    return macs
end

-- return the list of supported options
local function supportedOptions(token) -- luacheck: no unused args
--[[ curl --silent https://raw.githubusercontent.com/openssh/openssh-portable/master/ssh_config.5 | awk '$1==".It" && $2=="Cm" && $3!="Host" && $3!="Match" {print "        "$3}' | sort ]] -- luacheck: no max line length
    local options = {
        "AddKeysToAgent", "AddressFamily", "BatchMode", "BindAddress", "BindInterface", "CanonicalDomains",
        "CanonicalizeFallbackLocal", "CanonicalizeHostname", "CanonicalizeMaxDots", "CanonicalizePermittedCNAMEs",
        "CASignatureAlgorithms", "CertificateFile", "CheckHostIP", "Ciphers", "ClearAllForwardings", "Compression",
        "ConnectionAttempts", "ConnectTimeout", "ControlMaster", "ControlPath", "ControlPersist", "DynamicForward",
        "EnableEscapeCommandline", "EnableSSHKeysign", "EscapeChar", "ExitOnForwardFailure", "FingerprintHash",
        "ForkAfterAuthentication", "ForwardAgent", "ForwardX11", "ForwardX11Timeout", "ForwardX11Trusted",
        "GatewayPorts", "GlobalKnownHostsFile", "GSSAPIAuthentication", "GSSAPIDelegateCredentials", "HashKnownHosts",
        "HostbasedAcceptedAlgorithms", "HostbasedAuthentication", "HostKeyAlgorithms", "HostKeyAlias", "Hostname",
        "IdentitiesOnly", "IdentityAgent", "IdentityFile", "IgnoreUnknown", "Include", "IPQoS",
        "KbdInteractiveAuthentication", "KbdInteractiveDevices", "KexAlgorithms", "KnownHostsCommand", "LocalCommand",
        "LocalForward", "LogLevel", "LogVerbose", "MACs", "NoHostAuthenticationForLocalhost",
        "NumberOfPasswordPrompts", "ObscureKeystrokeTiming", "PasswordAuthentication", "PermitLocalCommand",
        "PermitRemoteOpen", "PKCS11Provider", "Port", "PreferredAuthentications", "ProxyCommand", "ProxyJump",
        "ProxyUseFdpass", "PubkeyAcceptedAlgorithms", "PubkeyAuthentication", "RekeyLimit", "RemoteCommand",
        "RemoteForward", "RequestTTY", "RequiredRSASize", "RevokedHostKeys", "SecurityKeyProvider", "SendEnv",
        "ServerAliveCountMax", "ServerAliveInterval", "SessionType", "SetEnv", "StdinNull", "StreamLocalBindMask",
        "StreamLocalBindUnlink", "StrictHostKeyChecking", "SyslogFacility", "Tag", "TCPKeepAlive", "Tunnel",
        "TunnelDevice", "UpdateHostKeys", "User", "UserKnownHostsFile", "VerifyHostKeyDNS", "VisualHostKey",
        "XAuthLocation",
    }
    return options
end

local ssh_parser = parser({hosts_with_port_flag},
    "-4", "-6", "-A", "-a", "-C", "-f", "-G", "-g", "-K", "-k", "-M",
    "-N", "-n", "-q", "-s", "-T", "-t", "-V", "-v", "-X", "-x", "-Y", "-y",
    "-B" .. parser({fromhistory=true}), -- How to find available bind_interface's?
    "-b" .. parser({localIPs}),
    "-c" .. parser({supportedCiphers}),
    "-D" .. parser({fromhistory=true, localIPs}),
    "-E" .. parser({clink.filematches}),
    "-e" .. parser({fromhistory=true}),
    "-F" .. parser({clink.filematches}),
    "-I" .. parser({fromhistory=true}),
    "-i" .. parser({clink.filematches}),
    "-J" .. parser({hosts_with_port}),
    "-L" .. parser({fromhistory=true}),
    "-l" .. parser({fromhistory=true}),
    "-m" .. parser({supportedMACs}),
    "-O" .. parser({fromhistory=true}),
    "-o" .. parser({supportedOptions}),
    "-p" .. parser({fromhistory=true}),
    "-Q" .. parser({"cipher", "cipher_auth", "help", "mac", "kex", "kex-gss", "key", "key-cert", "key-plain", "key-sig", "protocol-version", "sig"}), -- luacheck: no max line length
    "-R" .. parser({fromhistory=true}),
    "-S" .. parser({fromhistory=true}),
    "-W" .. parser({hosts_with_port}),
    "-w" .. parser({fromhistory=true})
)
:adddescriptions({
    ["-B"] = { " bind_interface", "" },
    ["-b"] = { " bind_address", "" },
    ["-c"] = { " cipher_spec", "" },
    ["-D"] = { " [bind_address:]port", "" },
    ["-E"] = { " log_file", "" },
    ["-e"] = { " escape_char", "" },
    ["-F"] = { " configfile", "" },
    ["-I"] = { " pkcs11", "" },
    ["-i"] = { " identity_file", "" },
    ["-J"] = { " [user@]host[:port]", "" },
    ["-L"] = { " address", "" },
    ["-l"] = { " login_name", "" },
    ["-m"] = { " mac_spec", "" },
    ["-O"] = { " ctl_cmd", "" },
    ["-o"] = { " option", "" },
    ["-p"] = { " port", "" },
    ["-Q"] = { " query_option", "" },
    ["-R"] = { " address", "" },
    ["-S"] = { " ctl_path", "" },
    ["-W"] = { " host:port", "" },
    ["-w"] = { " local_tun[:remote_tun]", "" },
})

clink.arg.register_parser("ssh", ssh_parser)

