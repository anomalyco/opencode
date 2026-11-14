//! What a plugin author writes: a plugin on the public SDK, `opencode-plugin-abi`, and nothing else. A counter in the
//! sidebar that a command and a click raise and storage keeps, a toast on a finished session, and a `shout` fence. Its
//! `cargo tree` has no OpenTUI and no crate of the TUI (`crates/plugin-abi/tests/sdk.rs`).

use opencode_plugin_abi::{
    Changed, Click, Command, Fence, Fenced, Host, Node, Placement, Read, Render, Setup, Span, Toast, Variant,
    export_plugin,
};

const COUNT: &str = "count";

fn setup(setup: &mut Setup) -> Result<(), String> {
    setup.storage_key(COUNT);
    setup.command(
        Command {
            name: "author.count".to_owned(),
            title: "Count".to_owned(),
            slash: Some("count".to_owned()),
            palette: true,
            ..Command::default()
        },
        |host, _| count(host),
    );
    setup.slot(Placement::append("sidebar.content"), |read, _, changed| sidebar(read, changed));
    setup.on_event(&["session.execution.succeeded"], |host, _| {
        host.toast(Toast::new(Variant::Info, "A session finished").title("Author"));
    });
    setup.code_block("shout", |_, fence| shout(fence));
    Ok(())
}

fn count(host: &dyn Host) {
    let count = stored(host);
    host.storage_set(COUNT, serde_json::json!({ "value": count + 1 }));
}

fn stored(read: &dyn Read) -> u64 {
    read.storage_get(COUNT).and_then(|value| value.get("value")?.as_u64()).unwrap_or(0)
}

fn sidebar(read: &dyn Read, changed: &Changed) -> Render {
    if !(changed.all || changed.local) {
        return Render::Keep;
    }
    let count = Node::text([Span::new(format!("Counted {}", stored(read))).fg("text.muted")]);
    Render::Show(Node::column(vec![count]).on_click(Click::command("author.count", None)))
}

fn shout(fence: &Fence) -> Fenced {
    let lines = fence.code.lines().map(|line| vec![Span::new(line.to_uppercase()).bold()]).collect();
    Fenced::Lines { lines, fg: None, drag: false }
}

export_plugin!("example.author", setup);
