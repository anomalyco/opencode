use opencode_plugin_abi::{Click, Command, Node, Placement, Render, Setup, Span, Toast, Variant, export_plugin};

fn setup(setup: &mut Setup) -> Result<(), String> {
    // A command in the palette and as `/hello`.
    setup.command(
        Command {
            name: "hello.greet".to_owned(),
            title: "Say hello".to_owned(),
            slash: Some("hello".to_owned()),
            palette: true,
            ..Command::default()
        },
        |host, _input| host.toast(Toast::new(Variant::Success, "Hello from a plugin")),
    );
    // A line at the end of the home screen's footer; a click runs the command.
    setup.slot(Placement::append("home.footer"), |_read, _input, _changed| {
        let text = Node::text([Span::new("hello").fg("text.muted")]);
        Render::Show(text.on_click(Click::command("hello.greet", None)))
    });
    Ok(())
}

export_plugin!("example.hello", setup);
