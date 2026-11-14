use opencode_plugin_abi::{Click, Command, Node, Placement, Render, Setup, Span, Toast, Variant, plugin};

fn setup(setup: &mut Setup) -> Result<(), String> {
    // A command in the palette and as `/hello`.
    setup.command(
        Command::default()
            .with_name("hello.greet".to_owned())
            .with_title("Say hello".to_owned())
            .with_slash(Some("hello".to_owned()))
            .with_palette(true),
        |host, _input| host.toast(Toast::new(Variant::Success, "Hello from a plugin")),
    );
    // A line at the end of the home screen's footer; a click runs the command.
    setup.slot(Placement::append("home.footer"), |_read, _input, _changed| {
        let text = Node::text([Span::new("hello").fg("text.muted")]);
        Render::Show(text.on_click(Click::command("hello.greet", None)))
    });
    Ok(())
}

plugin!(id = "example.hello", setup);
