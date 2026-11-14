//! The home footer plugin (E.14, row F01, `feature-plugins/home/footer.tsx`), appended to `home.footer`: the
//! MCP servers of the default location (`⊙ 2 MCP`, or `⊙ 1 MCP failed`, with `/mcps` from 64 columns; a click
//! opens the list), the failed TUI and server plugins (`⊙ 1 plugin failed`, with `/plugins` from 80 columns; a
//! click opens the plugin manager), the `home.footer.status` slot, and the version on the right from 64
//! columns. Hidden below 44x14. It is a plugin of the one API (O-67).

use opencode_plugin::abi::{self, Click, Layout, Node, Placement, Render, Span, Width};
use opencode_plugin::slot;

pub fn plugin() -> abi::Plugin {
    abi::Plugin { id: "opencode.home.footer", setup }
}

fn setup(setup: &mut abi::Setup) -> Result<(), String> {
    // Append keeps the path open to additive plugin claims; an external replace still takes it over.
    setup.slot(Placement::append(slot::HOME_FOOTER), |read, _, changed| {
        // It reads the MCP servers where the TUI works, the terminal size, and the failed plugins, which change with
        // where the TUI works as `local`.
        if !(changed.all || changed.size || changed.local || !changed.locations.is_empty()) {
            return Render::Keep;
        }
        let info = read.info();
        if !(changed.all || changed.size || changed.local || changed.location(&info.location)) {
            return Render::Keep;
        }
        let (width, height) = info.size;
        if height < 14 || width < 44 {
            return Render::Hide;
        }
        let list = read.mcp_servers(None).unwrap_or_default();
        let count = |tag: &str| list.iter().filter(|item| item.status.tag() == tag).count();
        let mut row = Vec::new();
        if !list.is_empty() {
            let (connected, failed) = (count("connected"), count("failed"));
            let spans = if failed > 0 {
                vec![Span::new("⊙ ").fg("text.feedback.error.base"), Span::new(format!("{failed} MCP failed"))]
            } else {
                let dot = if connected > 0 { "text.feedback.success.base" } else { "text.muted" };
                vec![Span::new("⊙ ").fg(dot), Span::new(format!("{connected} MCP"))]
            };
            let mut mcp = vec![Node::text(spans)];
            if width >= 64 {
                mcp.push(Node::text([Span::new("/mcps")]).fg("text.muted"));
            }
            let fixed = Layout::default().shrink(false);
            row.push(Node::row(mcp).gap(1).layout(fixed).on_click(Click::command("mcp.list", None)));
        }
        if info.failed_plugins > 0 {
            let failed = info.failed_plugins;
            let plural = if failed == 1 { "" } else { "s" };
            let spans = vec![
                Span::new("⊙ ").fg("text.feedback.error.base"),
                Span::new(format!("{failed} plugin{plural} failed")),
            ];
            let mut plugins = vec![Node::text(spans)];
            if width >= 80 {
                plugins.push(Node::text([Span::new("/plugins")]).fg("text.muted"));
            }
            let fixed = Layout::default().shrink(false);
            row.push(Node::row(plugins).gap(1).layout(fixed).on_click(Click::command("plugins.list", None)));
        }
        row.push(Node::slot(slot::HOME_FOOTER_STATUS));
        row.push(Node::column(Vec::new()).layout(Layout::default().grow()));
        if width >= 64 {
            let version = Node::text([Span::new(info.version)]).fg("text.muted");
            row.push(Node::column(vec![version]).layout(Layout::default().shrink(false)));
        }
        let full = Layout { width: Some(Width::Percent(100.0)), ..Layout::default() }.shrink(false);
        Render::Show(Node::row(row).gap(2).padding(2, if height < 16 { 0 } else { 1 }).layout(full))
    });
    Ok(())
}
