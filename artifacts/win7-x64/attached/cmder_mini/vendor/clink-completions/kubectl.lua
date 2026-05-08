local w = require('tables').wrap
local parser = clink.arg.new_parser

local function exec_kubectl(arguments, template)
    local f = io.popen("kubectl "..arguments.." -o template --template=\""..template.."\"")
	if not f then return w({}) end
	local output = f:read('*all')
	f:close()
	local res = w({})
	for element in output:gmatch("%S+") do table.insert(res, element) end
	return res
end

local function get_config(config)
    return exec_kubectl("config view", "{{ range ."..config.."  }}{{ .name }} {{ end }}")
end

local function get_config_func(config)
	return function()
	    return get_config(config)
	end
end

local function get_resources(noun)
	return exec_kubectl("get "..noun, "{{ range .items  }}{{ .metadata.name }} {{ end }}")
end

local function get_resources_func(noun)
	return function()
	    return get_resources(noun)
	end
end

local resource_parser = parser(
	{
		"all" .. parser({get_resources_func("all")}),
		"node" .. parser({get_resources_func("node")}),
		"service" .. parser({get_resources_func("service")}),
		"pod" .. parser({get_resources_func("pod")}),
		"deployment" .. parser({get_resources_func("deployment")})
	}
)

local scale_parser = parser(
	{
		"deployment" .. parser({get_resources_func("deployment")}, parser({"--replicas"}))
	}
)

local config_parser = parser(
	{
		"current-context",
		"delete-cluster",
		"delete-context",
		"get-clusters",
		"get-contexts",
		"rename-context",
		"set",
		"set-cluster",
		"set-context",
		"set-credentials",
		"unset",
		"use-context" .. parser({get_config_func("contexts")}),
		"view"
	}
)

local kubectl_parser = parser(
	{
	    "apply",
		"exec" .. parser({get_resources_func("pod")}, parser({ "-it"})),
		"get" .. resource_parser,
		"describe" .. resource_parser,
		"logs" .. parser({get_resources_func("pod")}),
		"port-forward" .. parser({get_resources_func("pod")}),
		"scale" .. scale_parser,
		"config" .. config_parser
	}
)

clink.arg.register_parser("kubectl", kubectl_parser)