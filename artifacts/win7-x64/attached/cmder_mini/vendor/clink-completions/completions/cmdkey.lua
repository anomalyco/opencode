require('arghelper')

local deadend = clink.argmatcher():nofiles()
local placeholder = clink.argmatcher():addarg()
local users = clink.argmatcher():addarg({fromhistory=true})

local add_flags = {
    {"/user:"..users, "username",           "Specify username"},
    {"/pass:"..placeholder, "password",     "Specify password"},
    {"/pass",                               "Prompt for password"},
    {"/smartcard",                          "Retrieve credential from a smart card"},
}

local function existing_targets(_, _, _, builder)
    local targets = {}
    local pending
    local f = io.popen("cmdkey.exe /list")
    if f then
        for line in f:lines() do
            local a,b = line:match("^ +Target: ([^=:]+):target=(.*)$")
            if a and b then
                pending = {type=a, target=b}
            elseif pending then
                local u = line:match("^ +User: (.+)$")
                if u then
                    table.insert(targets, {match=pending.target, type="arg", description=u.." ("..pending.type..")"})
                    pending = nil
                end
            end
        end
        f:close()
        if builder.setforcequoting then
            builder:setforcequoting()
        end
    end
    return targets
end

local list_targets = clink.argmatcher():addarg({fromhistory=true}):nofiles()
local domain_targets = clink.argmatcher():addarg({fromhistory=true}):_addexflags(add_flags):nofiles()
local generic_targets = clink.argmatcher():addarg({fromhistory=true}):_addexflags(add_flags):nofiles()
local delete_targets = clink.argmatcher():addarg({existing_targets}):nofiles()

clink.argmatcher("cmdkey")
:_addexflags({
    {"/list"..deadend,                      "List available credentials"},
    {"/list:"..list_targets, "targetname",  "List available credentials for targetname"},
    {"/add:"..domain_targets, "targetname", "Create domain credentials"},
    {"/generic:"..generic_targets, "targetname", "Create generic credentials"},
    {"/delete /ras"..deadend,               "Delete RAS credentials"},
    {"/delete:"..delete_targets, "targetname", "Delete existing credentials"},
    {"/?",                                  "Show help"},
    {hide=true, "/delete"},
    {hide=true, "/ras"},
    {hide=true, "/user:"..users},
    {hide=true, "/pass:"..placeholder},
    {hide=true, "/pass"},
    {hide=true, "/smartcard"},
})
:nofiles()

