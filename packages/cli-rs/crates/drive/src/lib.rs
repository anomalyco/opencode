//! The simulation UI endpoint, `OPENCODE_DRIVE` (H.4): a WebSocket server that drives a headless app as
//! `packages/simulation/src/frontend` drives the TS TUI. Requests run on the UI thread, one at a time; each action
//! feeds the bytes Core's mock input would send to the app's input parser, then paints a frame, as `actions.ts`
//! calls `renderOnce`. Mapping: opentui-rust `docs/headless.md`.

pub mod capture;
pub mod keys;
pub mod manifest;
pub mod protocol;

use opentui::App;
use opentui::input::{Input, Parser};
use opentui::widget::Widget;
use protocol::{Envelope, Request};
use serde_json::{Value, json};
use std::cell::RefCell;
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::rc::Rc;
use std::sync::mpsc;
use tokio_tungstenite::tungstenite::{self, Message};

pub use manifest::Manifest;

/// A started endpoint. Its threads run until the process ends; requests fail once the app has ended.
#[derive(Debug, Clone)]
pub struct Server {
    pub addr: SocketAddr,
}

impl Server {
    /// The endpoint's URL, as TS prints it.
    pub fn url(&self) -> String {
        format!("ws://{}", self.addr)
    }
}

/// Listens on `addr` and answers requests for `app`, which must be [headless](App::headless). The handshake reports
/// `version`, as TS reports `app.version`. Call it on the UI thread before [`App::run`].
pub fn start(app: &App, addr: SocketAddr, version: String) -> std::io::Result<Server> {
    let listener = TcpListener::bind(addr)?;
    let addr = listener.local_addr()?;
    let driver =
        Rc::new(RefCell::new(Driver { parser: Parser::new(app.session()), mouse: keys::MouseState::default() }));
    app.on_message(move |cx, call: &Call| {
        let answer = driver.borrow_mut().answer(cx.app(), &call.request);
        let _ = call.reply.send(answer);
    });
    let proxy = app.proxy();
    std::thread::Builder::new().name("drive-ui".into()).spawn(move || {
        for stream in listener.incoming().flatten() {
            let proxy = proxy.clone();
            let version = version.clone();
            let _ = std::thread::Builder::new()
                .name("drive-ui-socket".into())
                .spawn(move || serve(stream, &proxy, &version));
        }
    })?;
    Ok(Server { addr })
}

/// One request for the UI thread, with where its answer goes.
struct Call {
    request: Request,
    reply: mpsc::SyncSender<Result<Value, String>>,
}

fn serve(stream: TcpStream, proxy: &opentui::app::AppProxy, version: &str) {
    let Ok(mut socket) = tungstenite::accept(stream) else {
        return;
    };
    loop {
        let input = match socket.read() {
            Ok(Message::Text(text)) => text.to_string(),
            Ok(Message::Binary(bytes)) => String::from_utf8_lossy(&bytes).into_owned(),
            Ok(Message::Close(_)) | Err(_) => return,
            Ok(_) => continue,
        };
        if let Some(response) = respond(&input, proxy, version)
            && socket.send(Message::text(response.to_string())).is_err()
        {
            return;
        }
    }
}

fn respond(input: &str, proxy: &opentui::app::AppProxy, version: &str) -> Option<Value> {
    let Envelope { id, request } = match protocol::decode(input) {
        Ok(envelope) => envelope,
        Err(message) => return Some(protocol::failure(None, &message)),
    };
    let answer = match request {
        Request::Handshake(params) => protocol::handshake(&params, version),
        Request::Unsupported(method) => Err(protocol::unsupported(method)),
        request => ask(proxy, request),
    };
    match answer {
        Ok(result) => protocol::success(id, result),
        Err(message) => Some(protocol::failure(id, &message)),
    }
}

fn ask(proxy: &opentui::app::AppProxy, request: Request) -> Result<Value, String> {
    let (reply, answer) = mpsc::sync_channel(1);
    proxy.send(Call { request, reply }).map_err(|error| error.to_string())?;
    answer.recv().map_err(|_| opentui::app::ProxyError::Closed.to_string())?
}

/// The endpoint's state on the UI thread.
struct Driver {
    parser: Parser,
    mouse: keys::MouseState,
}

impl Driver {
    fn answer(&mut self, app: &App, request: &Request) -> Result<Value, String> {
        match request {
            Request::Capture => {
                return app.capture().map(|frame| capture::frame(&frame)).map_err(|error| error.to_string());
            }
            Request::Matches { text } => {
                // As TS, read the current frame without painting one; only before the first frame is there none.
                let frame = app.last_frame().map_or_else(|| app.capture(), Ok).map_err(|error| error.to_string())?;
                return Ok(json!(capture::matches(&frame, text)));
            }
            Request::Type { text } => self.feed(app, text.as_bytes())?,
            Request::Press { key, modifiers } => self.feed(app, &keys::press(key, *modifiers))?,
            Request::Enter => self.feed(app, &keys::enter())?,
            Request::Arrow(direction) => self.feed(app, &keys::arrow(*direction))?,
            Request::Mouse(mouse) => {
                let (width, height) = app.size();
                let (x, y) = mouse.position();
                if x >= u32::from(width) || y >= u32::from(height) {
                    return Err("mouse position must be within the terminal viewport".into());
                }
                let bytes = self.mouse.encode(*mouse);
                self.feed(app, &bytes)?;
            }
            Request::Resize { cols, rows } => {
                let size = |value: f64| {
                    (value.fract() == 0.0 && value >= 1.0 && value <= f64::from(u16::MAX)).then_some(value as u16)
                };
                let (Some(cols), Some(rows)) = (size(*cols), size(*rows)) else {
                    return Err("resize cols and rows must be positive integers".into());
                };
                app.resize(cols, rows).map_err(|error| error.to_string())?;
            }
            Request::Handshake(_) | Request::Unsupported(_) => {
                unreachable!("answered off the UI thread")
            }
        }
        app.capture().map_err(|error| error.to_string())?;
        // As Core's `currentFocusedEditor`: any focused input or textarea, the prompt or a dialog's search.
        let editor = app.focused().is_some_and(|widget| widget.element().is_editor());
        Ok(json!({ "focused": { "editor": editor }, "elements": [] }))
    }

    /// Parses bytes as if typed and dispatches the events. A partial sequence at the end ends at once, so a lone
    /// Escape is the Escape key instead of waiting for the input timeout.
    fn feed(&mut self, app: &App, bytes: &[u8]) -> Result<(), String> {
        let mut inputs = Vec::new();
        let parsed = self
            .parser
            .feed(bytes, app.now(), &mut inputs)
            .and_then(|()| self.parser.deadline().map_or(Ok(()), |deadline| self.parser.expire(deadline, &mut inputs)));
        parsed.map_err(|error| error.to_string())?;
        for input in inputs {
            if let Input::Event(event) = input {
                app.dispatch(event);
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use opentui::app::HeadlessOptions;
    use opentui::prelude::*;

    /// A client on another thread sends each request and collects the responses; the app records the events it got.
    #[test]
    fn requests_drive_a_headless_app() {
        let options = AppOptions { exit_on_ctrl_c: false, ..AppOptions::default() };
        let app = App::headless(HeadlessOptions { width: 30, height: 4, app: options }).unwrap();
        let input = opentui::widget::Input::new(&app);
        let submitted = Text::new(&app, "");
        app.root().add(&input).add(&submitted);
        app.focus(&input);
        input.on_submit({
            let submitted = submitted.clone();
            move |_cx, text| drop(submitted.set_text(format!("submitted {text}")))
        });
        let events = Rc::new(RefCell::new(Vec::new()));
        app.on_key_capture({
            let events = events.clone();
            move |_cx, key| events.borrow_mut().push(format!("{:?} {:?}", key.code, key.modifiers))
        });
        app.on_mouse({
            let events = events.clone();
            move |_cx, mouse| events.borrow_mut().push(format!("{:?} {} {}", mouse.kind, mouse.x, mouse.y))
        });
        let server = start(&app, SocketAddr::from(([127, 0, 0, 1], 0)), "1.2.3".into()).unwrap();

        let requests = [
            r#"{"jsonrpc":"2.0","id":1,"method":"simulation.handshake","params":{"client":{"name":"t","version":"1"},"expectedRole":"ui","offeredVersions":[1],"requiredCapabilities":["ui.capture"],"optionalCapabilities":[]}}"#,
            r#"{"jsonrpc":"2.0","id":2,"method":"ui.type","params":{"text":"Adx"}}"#,
            r#"{"jsonrpc":"2.0","id":3,"method":"ui.press","params":{"key":"backspace"}}"#,
            r#"{"jsonrpc":"2.0","id":4,"method":"ui.press","params":{"key":"a"}}"#,
            r#"{"jsonrpc":"2.0","id":5,"method":"ui.press","params":{"key":"c","modifiers":{"ctrl":true}}}"#,
            r#"{"jsonrpc":"2.0","id":6,"method":"ui.arrow","params":{"direction":"left"}}"#,
            r#"{"jsonrpc":"2.0","id":7,"method":"ui.matches","params":{"text":"Ada"}}"#,
            r#"{"jsonrpc":"2.0","id":8,"method":"ui.enter"}"#,
            r#"{"jsonrpc":"2.0","id":9,"method":"ui.matches","params":{"text":"submitted Ada"}}"#,
            r#"{"jsonrpc":"2.0","id":10,"method":"ui.mouse","params":{"action":"down","x":1,"y":1}}"#,
            r#"{"jsonrpc":"2.0","id":11,"method":"ui.mouse","params":{"action":"move","x":2,"y":1}}"#,
            r#"{"jsonrpc":"2.0","id":12,"method":"ui.mouse","params":{"action":"up","x":2,"y":1}}"#,
            r#"{"jsonrpc":"2.0","id":13,"method":"ui.mouse","params":{"action":"scroll","x":0,"y":0,"direction":"down"}}"#,
            r#"{"jsonrpc":"2.0","id":14,"method":"ui.mouse","params":{"action":"move","x":30,"y":0}}"#,
            r#"{"jsonrpc":"2.0","id":15,"method":"ui.resize","params":{"cols":0,"rows":3}}"#,
            r#"{"jsonrpc":"2.0","id":16,"method":"ui.resize","params":{"cols":20,"rows":3}}"#,
            r#"{"jsonrpc":"2.0","id":17,"method":"ui.capture"}"#,
            r#"{"jsonrpc":"2.0","id":18,"method":"ui.state"}"#,
            r#"{"jsonrpc":"2.0","method":"ui.press","params":{"key":"!"}}"#,
            r#"{"jsonrpc":"2.0","id":19,"method":"ui.nope"}"#,
        ];
        let proxy = app.proxy();
        let url = server.url();
        let client = std::thread::spawn(move || {
            let (mut socket, _) = tungstenite::connect(&url).unwrap();
            let mut responses = Vec::new();
            for request in requests {
                socket.send(Message::text(request)).unwrap();
                if request.contains(r#""id""#) {
                    let text = socket.read().unwrap().into_text().unwrap();
                    responses.push(serde_json::from_str::<Value>(&text).unwrap());
                }
            }
            let _ = proxy.quit();
            responses
        });
        app.clone().run().unwrap();
        let responses = client.join().unwrap();
        let result = |id: u64| {
            let response = responses.iter().find(|response| response["id"] == id).unwrap_or_else(|| panic!("no {id}"));
            response.get("result").cloned().ok_or_else(|| response["error"]["message"].as_str().unwrap().to_owned())
        };

        assert_eq!(result(1).unwrap()["server"]["version"], "1.2.3");
        assert_eq!(result(2).unwrap(), json!({ "focused": { "editor": true }, "elements": [] }));
        assert_eq!(result(7), Ok(json!(true)));
        assert_eq!(result(9), Ok(json!(true)));
        // The input under the pointer takes the wheel step, so no app mouse handler sees it.
        assert_eq!(result(13).unwrap()["elements"], json!([]));
        assert_eq!(result(14), Err("mouse position must be within the terminal viewport".into()));
        assert_eq!(result(15), Err("resize cols and rows must be positive integers".into()));
        let frame = result(17).unwrap();
        assert_eq!((frame["cols"].clone(), frame["rows"].clone()), (json!(20), json!(3)));
        let row = |y: usize| -> String {
            frame["lines"][y]["spans"].as_array().unwrap().iter().map(|span| span["text"].as_str().unwrap()).collect()
        };
        assert_eq!(row(0).trim_end(), "Ada");
        assert_eq!(row(1).trim_end(), "submitted Ada");
        assert!(result(18).unwrap_err().starts_with("ui.state is not supported"));
        let invalid = responses.last().unwrap();
        assert_eq!(invalid["id"], Value::Null);
        assert_eq!(responses.len(), 19);
        assert_eq!(
            *events.borrow(),
            [
                "Char('A') NONE",
                "Char('d') NONE",
                "Char('x') NONE",
                "Backspace NONE",
                "Char('a') NONE",
                "Char('c') ctrl",
                "Left NONE",
                "Enter NONE",
                "Down(Left) 1 1",
                "Drag(Left) 2 1",
                "Up(Left) 2 1",
                "Char('!') NONE",
            ]
            .map(str::to_owned)
        );
    }
}
