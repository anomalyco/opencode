//! `/btw` (E.14, row F03, `feature-plugins/prompt/btw.tsx`): `session.aside` asks a one-shot side question with
//! the session's context through `session.generate`, without adding to the conversation, and shows the answer
//! in a large dialog. While answers are pending, a `/btw` spinner shows in `prompt.footer.status`. It is a plugin of
//! the one API (O-67).

use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::rc::Rc;

use opencode_api::client::Client;
use opencode_api::generated::{SessionGenerateInput, SessionGenerateOutput, SessionID};
use opencode_plugin::abi::{
    self, Action, Command, Dialog, Host, Layout, Node, Panel, PanelAction, PanelBind, PanelSize, Placement, Render,
    RequestId, Span, Toast, Variant,
};
use opencode_plugin::slot;

use super::fetch::{data, fetch_of};

// `session.generate` exposes the session's tools but runs no tool loop, so a tool call would surface as an
// empty answer.
const INSTRUCTIONS: &str = "The user is asking a quick side question about the conversation so far. \
Answer directly and concisely in markdown from what you already know. \
Do not call any tools and do not take any actions.";

pub fn plugin() -> abi::Plugin {
    abi::Plugin { id: "opencode.btw", setup }
}

#[derive(Default)]
struct State {
    /// The questions asked and not answered yet, by request.
    pending: RefCell<HashMap<RequestId, String>>,
    /// The session the open prompt asks about, captured as it opened.
    prompted: RefCell<Option<String>>,
    /// The answer on screen.
    shown: RefCell<Option<Answer>>,
    answers: Cell<u64>,
}

struct Answer {
    key: String,
    question: String,
    text: String,
}

fn setup(setup: &mut abi::Setup) -> Result<(), String> {
    let state = Rc::new(State::default());
    let shown = state.clone();
    setup.slot(Placement::append(slot::PROMPT_FOOTER_STATUS), move |_, _, changed| {
        if !(changed.all || changed.woken) {
            return Render::Keep;
        }
        match shown.pending.borrow().is_empty() {
            true => Render::Hide,
            false => Render::Show(
                Node::row(vec![Node::Spinner { label: "/btw".to_owned() }]).layout(Layout::default().shrink(false)),
            ),
        }
    });
    let aside = state.clone();
    let command = Command {
        name: "session.aside".to_owned(),
        title: "Ask a side question".to_owned(),
        description: Some("One-shot answer from the session's context without adding to the conversation".to_owned()),
        group: Some("Session".to_owned()),
        palette: true,
        slash: Some("btw".to_owned()),
        arguments: true,
        ..Command::default()
    };
    setup.command(command, move |host, input| {
        let abi::Route::Session { id } = host.route() else {
            host.toast(Toast::new(Variant::Warning, "Open a session first"));
            return;
        };
        let question = input.map(str::trim).unwrap_or_default();
        if !question.is_empty() {
            return ask(host, &aside, id, question.to_owned());
        }
        *aside.prompted.borrow_mut() = Some(id);
        let action = Action::Command { name: "btw.ask".to_owned(), input: None };
        host.dialog(Dialog::Prompt { title: "/btw".to_owned(), placeholder: Some("Ask anything".to_owned()), action });
    });
    let prompted = state.clone();
    setup.command(hidden("btw.ask"), move |host, input| {
        let Some(session) = prompted.prompted.borrow_mut().take() else { return };
        if let Some(question) = input.filter(|question| !question.is_empty()) {
            ask(host, &prompted, session, question.to_owned());
        }
    });
    let copy = state.clone();
    setup.command(hidden("btw.copy"), move |host, _| {
        if let Some(answer) = copy.shown.borrow().as_ref() {
            host.copy(&answer.text, Some(Action::Command { name: "btw.copied".to_owned(), input: None }));
        }
    });
    let copied = state.clone();
    setup.command(hidden("btw.copied"), move |host, _| {
        if let Some(answer) = copied.shown.borrow().as_ref() {
            host.dialog(Dialog::Panel(panel(answer, true)));
        }
    });
    setup.on_reply(move |host, id, reply| {
        let Some(question) = state.pending.borrow_mut().remove(&id) else { return };
        let output = match data::<SessionGenerateOutput>(reply) {
            Ok(output) => output,
            Err(error) => return host.toast(Toast::new(Variant::Error, error)),
        };
        state.answers.set(state.answers.get() + 1);
        let answer =
            Answer { key: format!("answer.{}", state.answers.get()), question, text: output.text.trim().to_owned() };
        host.dialog(Dialog::Panel(panel(&answer, false)));
        *state.shown.borrow_mut() = Some(answer);
    });
    Ok(())
}

fn hidden(name: &str) -> Command {
    Command { name: name.to_owned(), ..Command::default() }
}

fn ask(host: &dyn Host, state: &State, session: String, question: String) {
    let input =
        SessionGenerateInput { session_id: SessionID(session), prompt: format!("{INSTRUCTIONS}\n\n{question}") };
    let call = Client::session_generate_call(&input).expect("the generate input encodes");
    state.pending.borrow_mut().insert(host.fetch(fetch_of(call)), question);
}

/// `Answer`: the question in the header, the answer as Markdown in a body at most 60% of the screen high, and
/// `copy response` (`c`), which becomes `✓ copied` once copied.
fn panel(answer: &Answer, copied: bool) -> Panel {
    let copy = Action::Command { name: "btw.copy".to_owned(), input: None };
    let action = match copied {
        true => PanelAction {
            title: "✓ copied".to_owned(),
            key: None,
            color: Some("text.feedback.success.base".into()),
            close: false,
            action: copy.clone(),
        },
        false => PanelAction {
            title: "copy response".to_owned(),
            key: Some("c".to_owned()),
            color: None,
            close: false,
            action: copy.clone(),
        },
    };
    Panel {
        key: answer.key.clone(),
        size: PanelSize::Large,
        title: vec![Span::new("/btw").bold()],
        subtitle: Some(answer.question.clone()),
        body: Node::Markdown { text: answer.text.clone() },
        actions: vec![action],
        binds: vec![PanelBind { key: "c".to_owned(), title: "Copy answer".to_owned(), action: copy }],
        bleed: true,
        centered: true,
    }
}
