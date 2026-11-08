//! The sidebar footer (E.14, row F08, `feature-plugins/sidebar/footer.tsx`): the "Getting started" card while
//! no provider is connected and it was not dismissed (from 22 rows), then the location as `directory:branch`,
//! which brightens under the pointer and opens the working directory menu (E.20) on a click. It is a plugin of the
//! one API (O-67).

use opencode_plugin::abi::{self, Click, Command, Justify, Layout, Node, Placement, Render, Span, Wrap};
use opencode_plugin::slot;
use serde_json::json;

pub fn plugin() -> abi::Plugin {
    abi::Plugin { id: "opencode.sidebar.footer", setup }
}

/// The hidden command the card's close button runs.
const DISMISS: &str = "sidebar.footer.dismiss";
const KEY: &str = "getting-started";

fn setup(setup: &mut abi::Setup) -> Result<(), String> {
    setup.storage_key(KEY);
    setup.command(Command { name: DISMISS.to_owned(), ..Command::default() }, |host, _| {
        host.storage_merge(KEY, serde_json::Map::from_iter([("dismissed".to_owned(), json!(true))]));
    });
    setup.slot(Placement::append(slot::SIDEBAR_FOOTER), |read, input, changed| {
        // The card follows the terminal height and the stored dismissal, the location the session.
        let session = input.session_id.as_deref().unwrap_or_default();
        if !(changed.all || changed.local || changed.size || changed.session(session) || !changed.locations.is_empty())
        {
            return Render::Keep;
        }
        Render::Show(view(read, session))
    });
    Ok(())
}

fn view(read: &dyn abi::Read, session: &str) -> Node {
    let info = read.info();
    let location = read
        .session(session)
        .map(|session| abi::LocationRef { directory: session.info.location.directory.0, workspace: None })
        .unwrap_or(info.location);
    let connected = read.integrations(Some(&location)).map(|list| list.iter().any(|item| !item.connections.is_empty()));
    let branch = read.vcs(Some(&location)).and_then(|vcs| vcs.branch.current);
    let dismissed = read.storage_get(KEY).and_then(|value| value.get("dismissed")?.as_bool()).unwrap_or(false);
    let mut children = Vec::new();
    if info.size.1 >= 22 && connected == Some(false) && !dismissed {
        children.push(card());
    }
    let home = std::env::var("HOME").unwrap_or_default();
    let directory = opencode_ui::path::abbreviate_home(&location.directory, &home);
    let value = match branch {
        Some(branch) => format!("{directory}:{branch}"),
        None => directory,
    };
    let path = Node::text([Span::new(crate::dialogs::open::truncate_file_path(&value, 38))])
        .fg("text.muted")
        .hover_fg("text.base")
        .wrap(Wrap::None)
        .truncate()
        .on_click(Click::command("workspace.directory", Some(location.directory)));
    children.push(Node::column(vec![path]));
    Node::column(children).gap(1)
}

/// `SidebarOnboarding`.
fn card() -> Node {
    let muted = |text: &str| Node::text([Span::new(text)]).fg("text.muted");
    let body = Node::column(vec![
        Node::row(vec![
            Node::text([Span::new("Getting started").fg("text.base").bold()]),
            Node::text([Span::new("✕")]).fg("text.muted").on_click(Click::command(DISMISS, None)),
        ])
        .justify(Justify::SpaceBetween),
        muted("OpenCode includes free models so you can start immediately."),
        muted("Connect from 75+ providers to use other models, including Claude, GPT, Gemini etc"),
        Node::row(vec![
            Node::text([Span::new("Connect provider").fg("text.base")]),
            Node::text([Span::new("/connect").fg("text.muted")]),
        ])
        .gap(1)
        .justify(Justify::SpaceBetween)
        .on_click(Click::command("provider.connect", None)),
    ])
    .gap(1)
    .layout(Layout::default().grow());
    Node::row(vec![Node::text([Span::new("⬖").fg("text.base")]).layout(Layout::default().shrink(false)), body])
        .bg("background.raised.high")
        .padding(2, 1)
        .gap(1)
}
