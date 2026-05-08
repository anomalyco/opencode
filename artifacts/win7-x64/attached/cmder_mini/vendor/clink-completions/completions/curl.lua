local clink_version = require('clink_version')
if not clink_version.supports_argmatcher_delayinit then
    log.info("curl.lua argmatcher requires a newer version of Clink; please upgrade.")
    return
end

require('help_parser').make('curl', '--help all', 'curl')
