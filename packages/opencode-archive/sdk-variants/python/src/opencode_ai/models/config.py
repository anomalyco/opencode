from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, Union, cast

from attrs import define as _attrs_define

from ..models.config_share import ConfigShare
from ..models.layout_config import LayoutConfig
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.config_agent import ConfigAgent
    from ..models.config_command import ConfigCommand
    from ..models.config_experimental import ConfigExperimental
    from ..models.config_formatter import ConfigFormatter
    from ..models.config_lsp import ConfigLsp
    from ..models.config_mcp import ConfigMcp
    from ..models.config_mode import ConfigMode
    from ..models.config_permission import ConfigPermission
    from ..models.config_provider import ConfigProvider
    from ..models.config_tools import ConfigTools
    from ..models.config_tui import ConfigTui
    from ..models.config_watcher import ConfigWatcher
    from ..models.keybinds_config import KeybindsConfig


T = TypeVar("T", bound="Config")


@_attrs_define
class Config:
    """
    Attributes:
        schema (Union[Unset, str]): JSON schema reference for configuration validation
        theme (Union[Unset, str]): Theme name to use for the interface
        keybinds (Union[Unset, KeybindsConfig]): Custom keybind configurations
        tui (Union[Unset, ConfigTui]): TUI specific settings
        command (Union[Unset, ConfigCommand]): Command configuration, see https://opencode.ai/docs/commands
        watcher (Union[Unset, ConfigWatcher]):
        plugin (Union[Unset, list[str]]):
        snapshot (Union[Unset, bool]):
        share (Union[Unset, ConfigShare]): Control sharing behavior:'manual' allows manual sharing via commands, 'auto'
            enables automatic sharing, 'disabled' disables all sharing
        autoshare (Union[Unset, bool]): @deprecated Use 'share' field instead. Share newly created sessions
            automatically
        autoupdate (Union[Unset, bool]): Automatically update to the latest version
        disabled_providers (Union[Unset, list[str]]): Disable providers that are loaded automatically
        model (Union[Unset, str]): Model to use in the format of provider/model, eg anthropic/claude-2
        small_model (Union[Unset, str]): Small model to use for tasks like title generation in the format of
            provider/model
        username (Union[Unset, str]): Custom username to display in conversations instead of system username
        mode (Union[Unset, ConfigMode]): @deprecated Use `agent` field instead.
        agent (Union[Unset, ConfigAgent]): Agent configuration, see https://opencode.ai/docs/agent
        provider (Union[Unset, ConfigProvider]): Custom provider configurations and model overrides
        mcp (Union[Unset, ConfigMcp]): MCP (Model Context Protocol) server configurations
        formatter (Union[Unset, ConfigFormatter]):
        lsp (Union[Unset, ConfigLsp]):
        instructions (Union[Unset, list[str]]): Additional instruction files or patterns to include
        layout (Union[Unset, LayoutConfig]): @deprecated Always uses stretch layout.
        permission (Union[Unset, ConfigPermission]):
        tools (Union[Unset, ConfigTools]):
        experimental (Union[Unset, ConfigExperimental]):
    """

    schema: Union[Unset, str] = UNSET
    theme: Union[Unset, str] = UNSET
    keybinds: Union[Unset, "KeybindsConfig"] = UNSET
    tui: Union[Unset, "ConfigTui"] = UNSET
    command: Union[Unset, "ConfigCommand"] = UNSET
    watcher: Union[Unset, "ConfigWatcher"] = UNSET
    plugin: Union[Unset, list[str]] = UNSET
    snapshot: Union[Unset, bool] = UNSET
    share: Union[Unset, ConfigShare] = UNSET
    autoshare: Union[Unset, bool] = UNSET
    autoupdate: Union[Unset, bool] = UNSET
    disabled_providers: Union[Unset, list[str]] = UNSET
    model: Union[Unset, str] = UNSET
    small_model: Union[Unset, str] = UNSET
    username: Union[Unset, str] = UNSET
    mode: Union[Unset, "ConfigMode"] = UNSET
    agent: Union[Unset, "ConfigAgent"] = UNSET
    provider: Union[Unset, "ConfigProvider"] = UNSET
    mcp: Union[Unset, "ConfigMcp"] = UNSET
    formatter: Union[Unset, "ConfigFormatter"] = UNSET
    lsp: Union[Unset, "ConfigLsp"] = UNSET
    instructions: Union[Unset, list[str]] = UNSET
    layout: Union[Unset, LayoutConfig] = UNSET
    permission: Union[Unset, "ConfigPermission"] = UNSET
    tools: Union[Unset, "ConfigTools"] = UNSET
    experimental: Union[Unset, "ConfigExperimental"] = UNSET

    def to_dict(self) -> dict[str, Any]:
        schema = self.schema

        theme = self.theme

        keybinds: Union[Unset, dict[str, Any]] = UNSET
        if not isinstance(self.keybinds, Unset):
            keybinds = self.keybinds.to_dict()

        tui: Union[Unset, dict[str, Any]] = UNSET
        if not isinstance(self.tui, Unset):
            tui = self.tui.to_dict()

        command: Union[Unset, dict[str, Any]] = UNSET
        if not isinstance(self.command, Unset):
            command = self.command.to_dict()

        watcher: Union[Unset, dict[str, Any]] = UNSET
        if not isinstance(self.watcher, Unset):
            watcher = self.watcher.to_dict()

        plugin: Union[Unset, list[str]] = UNSET
        if not isinstance(self.plugin, Unset):
            plugin = self.plugin

        snapshot = self.snapshot

        share: Union[Unset, str] = UNSET
        if not isinstance(self.share, Unset):
            share = self.share.value

        autoshare = self.autoshare

        autoupdate = self.autoupdate

        disabled_providers: Union[Unset, list[str]] = UNSET
        if not isinstance(self.disabled_providers, Unset):
            disabled_providers = self.disabled_providers

        model = self.model

        small_model = self.small_model

        username = self.username

        mode: Union[Unset, dict[str, Any]] = UNSET
        if not isinstance(self.mode, Unset):
            mode = self.mode.to_dict()

        agent: Union[Unset, dict[str, Any]] = UNSET
        if not isinstance(self.agent, Unset):
            agent = self.agent.to_dict()

        provider: Union[Unset, dict[str, Any]] = UNSET
        if not isinstance(self.provider, Unset):
            provider = self.provider.to_dict()

        mcp: Union[Unset, dict[str, Any]] = UNSET
        if not isinstance(self.mcp, Unset):
            mcp = self.mcp.to_dict()

        formatter: Union[Unset, dict[str, Any]] = UNSET
        if not isinstance(self.formatter, Unset):
            formatter = self.formatter.to_dict()

        lsp: Union[Unset, dict[str, Any]] = UNSET
        if not isinstance(self.lsp, Unset):
            lsp = self.lsp.to_dict()

        instructions: Union[Unset, list[str]] = UNSET
        if not isinstance(self.instructions, Unset):
            instructions = self.instructions

        layout: Union[Unset, str] = UNSET
        if not isinstance(self.layout, Unset):
            layout = self.layout.value

        permission: Union[Unset, dict[str, Any]] = UNSET
        if not isinstance(self.permission, Unset):
            permission = self.permission.to_dict()

        tools: Union[Unset, dict[str, Any]] = UNSET
        if not isinstance(self.tools, Unset):
            tools = self.tools.to_dict()

        experimental: Union[Unset, dict[str, Any]] = UNSET
        if not isinstance(self.experimental, Unset):
            experimental = self.experimental.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update({})
        if schema is not UNSET:
            field_dict["$schema"] = schema
        if theme is not UNSET:
            field_dict["theme"] = theme
        if keybinds is not UNSET:
            field_dict["keybinds"] = keybinds
        if tui is not UNSET:
            field_dict["tui"] = tui
        if command is not UNSET:
            field_dict["command"] = command
        if watcher is not UNSET:
            field_dict["watcher"] = watcher
        if plugin is not UNSET:
            field_dict["plugin"] = plugin
        if snapshot is not UNSET:
            field_dict["snapshot"] = snapshot
        if share is not UNSET:
            field_dict["share"] = share
        if autoshare is not UNSET:
            field_dict["autoshare"] = autoshare
        if autoupdate is not UNSET:
            field_dict["autoupdate"] = autoupdate
        if disabled_providers is not UNSET:
            field_dict["disabled_providers"] = disabled_providers
        if model is not UNSET:
            field_dict["model"] = model
        if small_model is not UNSET:
            field_dict["small_model"] = small_model
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
        if experimental is not UNSET:
            field_dict["experimental"] = experimental

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.config_agent import ConfigAgent
        from ..models.config_command import ConfigCommand
        from ..models.config_experimental import ConfigExperimental
        from ..models.config_formatter import ConfigFormatter
        from ..models.config_lsp import ConfigLsp
        from ..models.config_mcp import ConfigMcp
        from ..models.config_mode import ConfigMode
        from ..models.config_permission import ConfigPermission
        from ..models.config_provider import ConfigProvider
        from ..models.config_tools import ConfigTools
        from ..models.config_tui import ConfigTui
        from ..models.config_watcher import ConfigWatcher
        from ..models.keybinds_config import KeybindsConfig

        d = dict(src_dict)
        schema = d.pop("$schema", UNSET)

        theme = d.pop("theme", UNSET)

        _keybinds = d.pop("keybinds", UNSET)
        keybinds: Union[Unset, KeybindsConfig]
        if isinstance(_keybinds, Unset):
            keybinds = UNSET
        else:
            keybinds = KeybindsConfig.from_dict(_keybinds)

        _tui = d.pop("tui", UNSET)
        tui: Union[Unset, ConfigTui]
        if isinstance(_tui, Unset):
            tui = UNSET
        else:
            tui = ConfigTui.from_dict(_tui)

        _command = d.pop("command", UNSET)
        command: Union[Unset, ConfigCommand]
        if isinstance(_command, Unset):
            command = UNSET
        else:
            command = ConfigCommand.from_dict(_command)

        _watcher = d.pop("watcher", UNSET)
        watcher: Union[Unset, ConfigWatcher]
        if isinstance(_watcher, Unset):
            watcher = UNSET
        else:
            watcher = ConfigWatcher.from_dict(_watcher)

        plugin = cast(list[str], d.pop("plugin", UNSET))

        snapshot = d.pop("snapshot", UNSET)

        _share = d.pop("share", UNSET)
        share: Union[Unset, ConfigShare]
        if isinstance(_share, Unset):
            share = UNSET
        else:
            share = ConfigShare(_share)

        autoshare = d.pop("autoshare", UNSET)

        autoupdate = d.pop("autoupdate", UNSET)

        disabled_providers = cast(list[str], d.pop("disabled_providers", UNSET))

        model = d.pop("model", UNSET)

        small_model = d.pop("small_model", UNSET)

        username = d.pop("username", UNSET)

        _mode = d.pop("mode", UNSET)
        mode: Union[Unset, ConfigMode]
        if isinstance(_mode, Unset):
            mode = UNSET
        else:
            mode = ConfigMode.from_dict(_mode)

        _agent = d.pop("agent", UNSET)
        agent: Union[Unset, ConfigAgent]
        if isinstance(_agent, Unset):
            agent = UNSET
        else:
            agent = ConfigAgent.from_dict(_agent)

        _provider = d.pop("provider", UNSET)
        provider: Union[Unset, ConfigProvider]
        if isinstance(_provider, Unset):
            provider = UNSET
        else:
            provider = ConfigProvider.from_dict(_provider)

        _mcp = d.pop("mcp", UNSET)
        mcp: Union[Unset, ConfigMcp]
        if isinstance(_mcp, Unset):
            mcp = UNSET
        else:
            mcp = ConfigMcp.from_dict(_mcp)

        _formatter = d.pop("formatter", UNSET)
        formatter: Union[Unset, ConfigFormatter]
        if isinstance(_formatter, Unset):
            formatter = UNSET
        else:
            formatter = ConfigFormatter.from_dict(_formatter)

        _lsp = d.pop("lsp", UNSET)
        lsp: Union[Unset, ConfigLsp]
        if isinstance(_lsp, Unset):
            lsp = UNSET
        else:
            lsp = ConfigLsp.from_dict(_lsp)

        instructions = cast(list[str], d.pop("instructions", UNSET))

        _layout = d.pop("layout", UNSET)
        layout: Union[Unset, LayoutConfig]
        if isinstance(_layout, Unset):
            layout = UNSET
        else:
            layout = LayoutConfig(_layout)

        _permission = d.pop("permission", UNSET)
        permission: Union[Unset, ConfigPermission]
        if isinstance(_permission, Unset):
            permission = UNSET
        else:
            permission = ConfigPermission.from_dict(_permission)

        _tools = d.pop("tools", UNSET)
        tools: Union[Unset, ConfigTools]
        if isinstance(_tools, Unset):
            tools = UNSET
        else:
            tools = ConfigTools.from_dict(_tools)

        _experimental = d.pop("experimental", UNSET)
        experimental: Union[Unset, ConfigExperimental]
        if isinstance(_experimental, Unset):
            experimental = UNSET
        else:
            experimental = ConfigExperimental.from_dict(_experimental)

        config = cls(
            schema=schema,
            theme=theme,
            keybinds=keybinds,
            tui=tui,
            command=command,
            watcher=watcher,
            plugin=plugin,
            snapshot=snapshot,
            share=share,
            autoshare=autoshare,
            autoupdate=autoupdate,
            disabled_providers=disabled_providers,
            model=model,
            small_model=small_model,
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
            experimental=experimental,
        )

        return config
