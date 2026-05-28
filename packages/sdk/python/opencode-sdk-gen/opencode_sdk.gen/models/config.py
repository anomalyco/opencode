from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define

from ..models.config_autoupdate_type_1 import ConfigAutoupdateType1
from ..models.config_share import ConfigShare
from ..models.layout_config import LayoutConfig
from ..models.log_level import LogLevel
from ..models.permission_action_config import PermissionActionConfig
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.attachment_config import AttachmentConfig
    from ..models.config_agent import ConfigAgent
    from ..models.config_command import ConfigCommand
    from ..models.config_compaction import ConfigCompaction
    from ..models.config_enterprise import ConfigEnterprise
    from ..models.config_experimental import ConfigExperimental
    from ..models.config_formatter_type_1 import ConfigFormatterType1
    from ..models.config_lsp_type_1 import ConfigLspType1
    from ..models.config_mcp import ConfigMcp
    from ..models.config_mode import ConfigMode
    from ..models.config_plugin_item_type_1_item_type_1 import ConfigPluginItemType1ItemType1
    from ..models.config_provider import ConfigProvider
    from ..models.config_skills import ConfigSkills
    from ..models.config_tool_output import ConfigToolOutput
    from ..models.config_tools import ConfigTools
    from ..models.config_watcher import ConfigWatcher
    from ..models.permission_config_type_1 import PermissionConfigType1
    from ..models.reference_config import ReferenceConfig
    from ..models.server_config import ServerConfig


T = TypeVar("T", bound="Config")


@_attrs_define
class Config:
    """
    Attributes:
        schema (str | Unset):
        shell (str | Unset):
        log_level (LogLevel | Unset): Log level
        server (ServerConfig | Unset): Server configuration for opencode serve and web commands
        command (ConfigCommand | Unset):
        skills (ConfigSkills | Unset):
        reference (ReferenceConfig | Unset):
        watcher (ConfigWatcher | Unset):
        snapshot (bool | Unset):
        plugin (list[list[ConfigPluginItemType1ItemType1 | str] | str] | Unset):
        share (ConfigShare | Unset):
        autoshare (bool | Unset):
        autoupdate (bool | ConfigAutoupdateType1 | Unset): Automatically update to the latest version. Set to true to
            auto-update, false to disable, or 'notify' to show update notifications
        disabled_providers (list[str] | Unset):
        enabled_providers (list[str] | Unset):
        model (str | Unset):
        small_model (str | Unset):
        default_agent (str | Unset):
        username (str | Unset):
        mode (ConfigMode | Unset):
        agent (ConfigAgent | Unset):
        provider (ConfigProvider | Unset):
        mcp (ConfigMcp | Unset):
        formatter (bool | ConfigFormatterType1 | Unset): Enable or configure formatters. Omit or set to false to
            disable, true to enable built-ins, or an object to enable built-ins with overrides.
        lsp (bool | ConfigLspType1 | Unset): Enable or configure LSP servers. Omit or set to false to disable, true to
            enable built-ins, or an object to enable built-ins with overrides.
        instructions (list[str] | Unset):
        layout (LayoutConfig | Unset): @deprecated Always uses stretch layout.
        permission (PermissionActionConfig | PermissionConfigType1 | Unset):
        tools (ConfigTools | Unset):
        attachment (AttachmentConfig | Unset):
        enterprise (ConfigEnterprise | Unset):
        tool_output (ConfigToolOutput | Unset):
        compaction (ConfigCompaction | Unset):
        experimental (ConfigExperimental | Unset):
    """

    schema: str | Unset = UNSET
    shell: str | Unset = UNSET
    log_level: LogLevel | Unset = UNSET
    server: ServerConfig | Unset = UNSET
    command: ConfigCommand | Unset = UNSET
    skills: ConfigSkills | Unset = UNSET
    reference: ReferenceConfig | Unset = UNSET
    watcher: ConfigWatcher | Unset = UNSET
    snapshot: bool | Unset = UNSET
    plugin: list[list[ConfigPluginItemType1ItemType1 | str] | str] | Unset = UNSET
    share: ConfigShare | Unset = UNSET
    autoshare: bool | Unset = UNSET
    autoupdate: bool | ConfigAutoupdateType1 | Unset = UNSET
    disabled_providers: list[str] | Unset = UNSET
    enabled_providers: list[str] | Unset = UNSET
    model: str | Unset = UNSET
    small_model: str | Unset = UNSET
    default_agent: str | Unset = UNSET
    username: str | Unset = UNSET
    mode: ConfigMode | Unset = UNSET
    agent: ConfigAgent | Unset = UNSET
    provider: ConfigProvider | Unset = UNSET
    mcp: ConfigMcp | Unset = UNSET
    formatter: bool | ConfigFormatterType1 | Unset = UNSET
    lsp: bool | ConfigLspType1 | Unset = UNSET
    instructions: list[str] | Unset = UNSET
    layout: LayoutConfig | Unset = UNSET
    permission: PermissionActionConfig | PermissionConfigType1 | Unset = UNSET
    tools: ConfigTools | Unset = UNSET
    attachment: AttachmentConfig | Unset = UNSET
    enterprise: ConfigEnterprise | Unset = UNSET
    tool_output: ConfigToolOutput | Unset = UNSET
    compaction: ConfigCompaction | Unset = UNSET
    experimental: ConfigExperimental | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        from ..models.config_formatter_type_1 import ConfigFormatterType1
        from ..models.config_lsp_type_1 import ConfigLspType1
        from ..models.config_plugin_item_type_1_item_type_1 import ConfigPluginItemType1ItemType1

        schema = self.schema

        shell = self.shell

        log_level: str | Unset = UNSET
        if not isinstance(self.log_level, Unset):
            log_level = self.log_level.value

        server: dict[str, Any] | Unset = UNSET
        if not isinstance(self.server, Unset):
            server = self.server.to_dict()

        command: dict[str, Any] | Unset = UNSET
        if not isinstance(self.command, Unset):
            command = self.command.to_dict()

        skills: dict[str, Any] | Unset = UNSET
        if not isinstance(self.skills, Unset):
            skills = self.skills.to_dict()

        reference: dict[str, Any] | Unset = UNSET
        if not isinstance(self.reference, Unset):
            reference = self.reference.to_dict()

        watcher: dict[str, Any] | Unset = UNSET
        if not isinstance(self.watcher, Unset):
            watcher = self.watcher.to_dict()

        snapshot = self.snapshot

        plugin: list[list[dict[str, Any] | str] | str] | Unset = UNSET
        if not isinstance(self.plugin, Unset):
            plugin = []
            for plugin_item_data in self.plugin:
                plugin_item: list[dict[str, Any] | str] | str
                if isinstance(plugin_item_data, list):
                    plugin_item = []
                    for plugin_item_type_1_item_data in plugin_item_data:
                        plugin_item_type_1_item: dict[str, Any] | str
                        if isinstance(plugin_item_type_1_item_data, ConfigPluginItemType1ItemType1):
                            plugin_item_type_1_item = plugin_item_type_1_item_data.to_dict()
                        else:
                            plugin_item_type_1_item = plugin_item_type_1_item_data
                        plugin_item.append(plugin_item_type_1_item)

                else:
                    plugin_item = plugin_item_data
                plugin.append(plugin_item)

        share: str | Unset = UNSET
        if not isinstance(self.share, Unset):
            share = self.share.value

        autoshare = self.autoshare

        autoupdate: bool | str | Unset
        if isinstance(self.autoupdate, Unset):
            autoupdate = UNSET
        elif isinstance(self.autoupdate, ConfigAutoupdateType1):
            autoupdate = self.autoupdate.value
        else:
            autoupdate = self.autoupdate

        disabled_providers: list[str] | Unset = UNSET
        if not isinstance(self.disabled_providers, Unset):
            disabled_providers = self.disabled_providers

        enabled_providers: list[str] | Unset = UNSET
        if not isinstance(self.enabled_providers, Unset):
            enabled_providers = self.enabled_providers

        model = self.model

        small_model = self.small_model

        default_agent = self.default_agent

        username = self.username

        mode: dict[str, Any] | Unset = UNSET
        if not isinstance(self.mode, Unset):
            mode = self.mode.to_dict()

        agent: dict[str, Any] | Unset = UNSET
        if not isinstance(self.agent, Unset):
            agent = self.agent.to_dict()

        provider: dict[str, Any] | Unset = UNSET
        if not isinstance(self.provider, Unset):
            provider = self.provider.to_dict()

        mcp: dict[str, Any] | Unset = UNSET
        if not isinstance(self.mcp, Unset):
            mcp = self.mcp.to_dict()

        formatter: bool | dict[str, Any] | Unset
        if isinstance(self.formatter, Unset):
            formatter = UNSET
        elif isinstance(self.formatter, ConfigFormatterType1):
            formatter = self.formatter.to_dict()
        else:
            formatter = self.formatter

        lsp: bool | dict[str, Any] | Unset
        if isinstance(self.lsp, Unset):
            lsp = UNSET
        elif isinstance(self.lsp, ConfigLspType1):
            lsp = self.lsp.to_dict()
        else:
            lsp = self.lsp

        instructions: list[str] | Unset = UNSET
        if not isinstance(self.instructions, Unset):
            instructions = self.instructions

        layout: str | Unset = UNSET
        if not isinstance(self.layout, Unset):
            layout = self.layout.value

        permission: dict[str, Any] | str | Unset
        if isinstance(self.permission, Unset):
            permission = UNSET
        elif isinstance(self.permission, PermissionActionConfig):
            permission = self.permission.value
        else:
            permission = self.permission.to_dict()

        tools: dict[str, Any] | Unset = UNSET
        if not isinstance(self.tools, Unset):
            tools = self.tools.to_dict()

        attachment: dict[str, Any] | Unset = UNSET
        if not isinstance(self.attachment, Unset):
            attachment = self.attachment.to_dict()

        enterprise: dict[str, Any] | Unset = UNSET
        if not isinstance(self.enterprise, Unset):
            enterprise = self.enterprise.to_dict()

        tool_output: dict[str, Any] | Unset = UNSET
        if not isinstance(self.tool_output, Unset):
            tool_output = self.tool_output.to_dict()

        compaction: dict[str, Any] | Unset = UNSET
        if not isinstance(self.compaction, Unset):
            compaction = self.compaction.to_dict()

        experimental: dict[str, Any] | Unset = UNSET
        if not isinstance(self.experimental, Unset):
            experimental = self.experimental.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update({})
        if schema is not UNSET:
            field_dict["$schema"] = schema
        if shell is not UNSET:
            field_dict["shell"] = shell
        if log_level is not UNSET:
            field_dict["logLevel"] = log_level
        if server is not UNSET:
            field_dict["server"] = server
        if command is not UNSET:
            field_dict["command"] = command
        if skills is not UNSET:
            field_dict["skills"] = skills
        if reference is not UNSET:
            field_dict["reference"] = reference
        if watcher is not UNSET:
            field_dict["watcher"] = watcher
        if snapshot is not UNSET:
            field_dict["snapshot"] = snapshot
        if plugin is not UNSET:
            field_dict["plugin"] = plugin
        if share is not UNSET:
            field_dict["share"] = share
        if autoshare is not UNSET:
            field_dict["autoshare"] = autoshare
        if autoupdate is not UNSET:
            field_dict["autoupdate"] = autoupdate
        if disabled_providers is not UNSET:
            field_dict["disabled_providers"] = disabled_providers
        if enabled_providers is not UNSET:
            field_dict["enabled_providers"] = enabled_providers
        if model is not UNSET:
            field_dict["model"] = model
        if small_model is not UNSET:
            field_dict["small_model"] = small_model
        if default_agent is not UNSET:
            field_dict["default_agent"] = default_agent
        if username is not UNSET:
            field_dict["username"] = username
        if mode is not UNSET:
            field_dict["mode"] = mode
        if agent is not UNSET:
            field_dict["agent"] = agent
        if provider is not UNSET:
            field_dict["provider"] = provider
        if mcp is not UNSET:
            field_dict["mcp"] = mcp
        if formatter is not UNSET:
            field_dict["formatter"] = formatter
        if lsp is not UNSET:
            field_dict["lsp"] = lsp
        if instructions is not UNSET:
            field_dict["instructions"] = instructions
        if layout is not UNSET:
            field_dict["layout"] = layout
        if permission is not UNSET:
            field_dict["permission"] = permission
        if tools is not UNSET:
            field_dict["tools"] = tools
        if attachment is not UNSET:
            field_dict["attachment"] = attachment
        if enterprise is not UNSET:
            field_dict["enterprise"] = enterprise
        if tool_output is not UNSET:
            field_dict["tool_output"] = tool_output
        if compaction is not UNSET:
            field_dict["compaction"] = compaction
        if experimental is not UNSET:
            field_dict["experimental"] = experimental

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.attachment_config import AttachmentConfig
        from ..models.config_agent import ConfigAgent
        from ..models.config_command import ConfigCommand
        from ..models.config_compaction import ConfigCompaction
        from ..models.config_enterprise import ConfigEnterprise
        from ..models.config_experimental import ConfigExperimental
        from ..models.config_formatter_type_1 import ConfigFormatterType1
        from ..models.config_lsp_type_1 import ConfigLspType1
        from ..models.config_mcp import ConfigMcp
        from ..models.config_mode import ConfigMode
        from ..models.config_plugin_item_type_1_item_type_1 import ConfigPluginItemType1ItemType1
        from ..models.config_provider import ConfigProvider
        from ..models.config_skills import ConfigSkills
        from ..models.config_tool_output import ConfigToolOutput
        from ..models.config_tools import ConfigTools
        from ..models.config_watcher import ConfigWatcher
        from ..models.permission_config_type_1 import PermissionConfigType1
        from ..models.reference_config import ReferenceConfig
        from ..models.server_config import ServerConfig

        d = dict(src_dict)
        schema = d.pop("$schema", UNSET)

        shell = d.pop("shell", UNSET)

        _log_level = d.pop("logLevel", UNSET)
        log_level: LogLevel | Unset
        if isinstance(_log_level, Unset):
            log_level = UNSET
        else:
            log_level = LogLevel(_log_level)

        _server = d.pop("server", UNSET)
        server: ServerConfig | Unset
        if isinstance(_server, Unset):
            server = UNSET
        else:
            server = ServerConfig.from_dict(_server)

        _command = d.pop("command", UNSET)
        command: ConfigCommand | Unset
        if isinstance(_command, Unset):
            command = UNSET
        else:
            command = ConfigCommand.from_dict(_command)

        _skills = d.pop("skills", UNSET)
        skills: ConfigSkills | Unset
        if isinstance(_skills, Unset):
            skills = UNSET
        else:
            skills = ConfigSkills.from_dict(_skills)

        _reference = d.pop("reference", UNSET)
        reference: ReferenceConfig | Unset
        if isinstance(_reference, Unset):
            reference = UNSET
        else:
            reference = ReferenceConfig.from_dict(_reference)

        _watcher = d.pop("watcher", UNSET)
        watcher: ConfigWatcher | Unset
        if isinstance(_watcher, Unset):
            watcher = UNSET
        else:
            watcher = ConfigWatcher.from_dict(_watcher)

        snapshot = d.pop("snapshot", UNSET)

        _plugin = d.pop("plugin", UNSET)
        plugin: list[list[ConfigPluginItemType1ItemType1 | str] | str] | Unset = UNSET
        if _plugin is not UNSET:
            plugin = []
            for plugin_item_data in _plugin:

                def _parse_plugin_item(data: object) -> list[ConfigPluginItemType1ItemType1 | str] | str:
                    try:
                        if not isinstance(data, list):
                            raise TypeError()
                        plugin_item_type_1 = []
                        _plugin_item_type_1 = data
                        for plugin_item_type_1_item_data in _plugin_item_type_1:

                            def _parse_plugin_item_type_1_item(data: object) -> ConfigPluginItemType1ItemType1 | str:
                                try:
                                    if not isinstance(data, dict):
                                        raise TypeError()
                                    plugin_item_type_1_item_type_1 = ConfigPluginItemType1ItemType1.from_dict(data)

                                    return plugin_item_type_1_item_type_1
                                except (TypeError, ValueError, AttributeError, KeyError):
                                    pass
                                return cast(ConfigPluginItemType1ItemType1 | str, data)

                            plugin_item_type_1_item = _parse_plugin_item_type_1_item(plugin_item_type_1_item_data)

                            plugin_item_type_1.append(plugin_item_type_1_item)

                        return plugin_item_type_1
                    except (TypeError, ValueError, AttributeError, KeyError):
                        pass
                    return cast(list[ConfigPluginItemType1ItemType1 | str] | str, data)

                plugin_item = _parse_plugin_item(plugin_item_data)

                plugin.append(plugin_item)

        _share = d.pop("share", UNSET)
        share: ConfigShare | Unset
        if isinstance(_share, Unset):
            share = UNSET
        else:
            share = ConfigShare(_share)

        autoshare = d.pop("autoshare", UNSET)

        def _parse_autoupdate(data: object) -> bool | ConfigAutoupdateType1 | Unset:
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                autoupdate_type_1 = ConfigAutoupdateType1(data)

                return autoupdate_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(bool | ConfigAutoupdateType1 | Unset, data)

        autoupdate = _parse_autoupdate(d.pop("autoupdate", UNSET))

        disabled_providers = cast(list[str], d.pop("disabled_providers", UNSET))

        enabled_providers = cast(list[str], d.pop("enabled_providers", UNSET))

        model = d.pop("model", UNSET)

        small_model = d.pop("small_model", UNSET)

        default_agent = d.pop("default_agent", UNSET)

        username = d.pop("username", UNSET)

        _mode = d.pop("mode", UNSET)
        mode: ConfigMode | Unset
        if isinstance(_mode, Unset):
            mode = UNSET
        else:
            mode = ConfigMode.from_dict(_mode)

        _agent = d.pop("agent", UNSET)
        agent: ConfigAgent | Unset
        if isinstance(_agent, Unset):
            agent = UNSET
        else:
            agent = ConfigAgent.from_dict(_agent)

        _provider = d.pop("provider", UNSET)
        provider: ConfigProvider | Unset
        if isinstance(_provider, Unset):
            provider = UNSET
        else:
            provider = ConfigProvider.from_dict(_provider)

        _mcp = d.pop("mcp", UNSET)
        mcp: ConfigMcp | Unset
        if isinstance(_mcp, Unset):
            mcp = UNSET
        else:
            mcp = ConfigMcp.from_dict(_mcp)

        def _parse_formatter(data: object) -> bool | ConfigFormatterType1 | Unset:
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                formatter_type_1 = ConfigFormatterType1.from_dict(data)

                return formatter_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(bool | ConfigFormatterType1 | Unset, data)

        formatter = _parse_formatter(d.pop("formatter", UNSET))

        def _parse_lsp(data: object) -> bool | ConfigLspType1 | Unset:
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                lsp_type_1 = ConfigLspType1.from_dict(data)

                return lsp_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(bool | ConfigLspType1 | Unset, data)

        lsp = _parse_lsp(d.pop("lsp", UNSET))

        instructions = cast(list[str], d.pop("instructions", UNSET))

        _layout = d.pop("layout", UNSET)
        layout: LayoutConfig | Unset
        if isinstance(_layout, Unset):
            layout = UNSET
        else:
            layout = LayoutConfig(_layout)

        def _parse_permission(data: object) -> PermissionActionConfig | PermissionConfigType1 | Unset:
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                componentsschemas_permission_config_type_0 = PermissionActionConfig(data)

                return componentsschemas_permission_config_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            componentsschemas_permission_config_type_1 = PermissionConfigType1.from_dict(data)

            return componentsschemas_permission_config_type_1

        permission = _parse_permission(d.pop("permission", UNSET))

        _tools = d.pop("tools", UNSET)
        tools: ConfigTools | Unset
        if isinstance(_tools, Unset):
            tools = UNSET
        else:
            tools = ConfigTools.from_dict(_tools)

        _attachment = d.pop("attachment", UNSET)
        attachment: AttachmentConfig | Unset
        if isinstance(_attachment, Unset):
            attachment = UNSET
        else:
            attachment = AttachmentConfig.from_dict(_attachment)

        _enterprise = d.pop("enterprise", UNSET)
        enterprise: ConfigEnterprise | Unset
        if isinstance(_enterprise, Unset):
            enterprise = UNSET
        else:
            enterprise = ConfigEnterprise.from_dict(_enterprise)

        _tool_output = d.pop("tool_output", UNSET)
        tool_output: ConfigToolOutput | Unset
        if isinstance(_tool_output, Unset):
            tool_output = UNSET
        else:
            tool_output = ConfigToolOutput.from_dict(_tool_output)

        _compaction = d.pop("compaction", UNSET)
        compaction: ConfigCompaction | Unset
        if isinstance(_compaction, Unset):
            compaction = UNSET
        else:
            compaction = ConfigCompaction.from_dict(_compaction)

        _experimental = d.pop("experimental", UNSET)
        experimental: ConfigExperimental | Unset
        if isinstance(_experimental, Unset):
            experimental = UNSET
        else:
            experimental = ConfigExperimental.from_dict(_experimental)

        config = cls(
            schema=schema,
            shell=shell,
            log_level=log_level,
            server=server,
            command=command,
            skills=skills,
            reference=reference,
            watcher=watcher,
            snapshot=snapshot,
            plugin=plugin,
            share=share,
            autoshare=autoshare,
            autoupdate=autoupdate,
            disabled_providers=disabled_providers,
            enabled_providers=enabled_providers,
            model=model,
            small_model=small_model,
            default_agent=default_agent,
            username=username,
            mode=mode,
            agent=agent,
            provider=provider,
            mcp=mcp,
            formatter=formatter,
            lsp=lsp,
            instructions=instructions,
            layout=layout,
            permission=permission,
            tools=tools,
            attachment=attachment,
            enterprise=enterprise,
            tool_output=tool_output,
            compaction=compaction,
            experimental=experimental,
        )

        return config
