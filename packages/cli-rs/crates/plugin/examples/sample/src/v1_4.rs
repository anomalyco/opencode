//! A plugin written against ABI 1.4 and built on the frozen 1.4 crate: a fence, a slot of a padded box, and a command.
//! Never port it to a newer API; it proves that a 1.4 plugin keeps loading and rendering on a newer host.

use abi_1_4::{Command, Fenced, Node, Placement, Render, Setup, Span, Toast, Variant, export_plugin};

fn setup(setup: &mut Setup) -> Result<(), String> {
    let command = Command { name: "sample.hello".to_owned(), title: "Say hello".to_owned(), ..Command::default() };
    setup.command(command, |host, _| host.toast(Toast::new(Variant::Success, "Hello from sample 1.4")));
    setup.code_block("sample", |_, fence| Fenced::Lines {
        lines: vec![vec![Span::new(format!("SAMPLE 1.4 {}", fence.code.trim().to_uppercase()))]],
        fg: None,
        drag: false,
    });
    setup.slot(Placement::append("home.footer"), |_, _, _| {
        Render::Show(Node::row(vec![Node::text([Span::new("sample plugin 1.4: home.footer")])]).padding(2, 0))
    });
    Ok(())
}

export_plugin!("sample", setup);
