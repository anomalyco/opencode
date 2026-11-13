use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;

use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};

use crate::service::{
    PipeMetadata, ProcessExit, ProcessInfo, ProcessMode, ProcessSignal, TerminalId,
};

pub const PROTOCOL_VERSION: u32 = 8;
/// Additive capabilities of this daemon. Breaking changes bump
/// `PROTOCOL_VERSION`; everything in protocol 8 needs no feature.
pub const FEATURES: &[&str] = &[];

pub fn features() -> Vec<String> {
    FEATURES.iter().map(|feature| feature.to_string()).collect()
}
pub const MAX_FRAME_BYTES: usize = 8 * 1024 * 1024;
const OUTPUT_FRAME_TAG: u8 = 0;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AttachmentRole {
    Controller,
    Observer,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Envelope {
    pub token: String,
    pub request: Request,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "op")]
pub enum Request {
    Ping,
    Own {
        instance_id: String,
        ticket: Option<String>,
    },
    PrepareHandoff,
    CreatePty {
        program: String,
        args: Vec<String>,
        cwd: PathBuf,
        env: HashMap<String, String>,
        group_id: String,
        title: String,
        cols: u16,
        rows: u16,
    },
    /// The child gets exactly `env`; `cwd` and `output_path` must be absolute.
    CreatePipe {
        program: String,
        args: Vec<String>,
        cwd: PathBuf,
        env: HashMap<String, String>,
        group_id: String,
        output_path: PathBuf,
        metadata: PipeMetadata,
    },
    List {
        mode: ProcessMode,
    },
    Get {
        id: TerminalId,
    },
    /// Pipe only. Answered with one `Exited` once the process has exited.
    Wait {
        id: TerminalId,
    },
    /// Pipe only. Signals the process group without removing the process.
    Signal {
        id: TerminalId,
        signal: ProcessSignal,
    },
    /// Pipe only. Replaces the metadata given to `create_pipe`.
    SetMetadata {
        id: TerminalId,
        metadata: PipeMetadata,
    },
    Write {
        id: TerminalId,
        attachment_id: Option<String>,
        data_base64: String,
    },
    Resize {
        id: TerminalId,
        attachment_id: Option<String>,
        cols: u16,
        rows: u16,
    },
    Control {
        id: TerminalId,
        attachment_id: String,
        cols: u16,
        rows: u16,
    },
    Input {
        id: TerminalId,
        attachment_id: String,
        cols: u16,
        rows: u16,
        data_base64: String,
    },
    Snapshot {
        id: TerminalId,
    },
    ReadRows {
        id: TerminalId,
        rows: Option<u16>,
    },
    Rename {
        id: TerminalId,
        title: Option<String>,
    },
    Replay {
        id: TerminalId,
        offset: u64,
    },
    Subscribe {
        id: TerminalId,
        offset: u64,
        attachment_id: String,
        role: AttachmentRole,
        takeover: bool,
    },
    Terminate {
        id: TerminalId,
    },
    Shutdown,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "type")]
pub enum Response {
    Owned,
    Handoff {
        ticket: String,
        expires_at: u64,
    },
    Pong {
        instance_id: String,
        pid: u32,
        protocol: u32,
        features: Vec<String>,
    },
    Created {
        process: ProcessInfo,
    },
    Process {
        process: ProcessInfo,
    },
    Processes {
        processes: Vec<ProcessInfo>,
    },
    Ok,
    Snapshot {
        process: ProcessInfo,
        text: String,
        checkpoint_base64: String,
        cursor_x: u16,
        cursor_y: u16,
    },
    Rows {
        process: ProcessInfo,
        lines: Vec<String>,
        cursor_x: u16,
        cursor_y: u16,
    },
    Replay {
        requested_offset: u64,
        available_offset: u64,
        end_offset: u64,
        truncated: bool,
        data_base64: String,
    },
    Attached {
        process: ProcessInfo,
        role: AttachmentRole,
        generation: u64,
        requested_offset: u64,
        available_offset: u64,
        end_offset: u64,
        truncated: bool,
        replay_base64: String,
    },
    Resized {
        cols: u16,
        rows: u16,
        generation: u64,
        checkpoint_base64: String,
    },
    Exited {
        exit_code: Option<u32>,
        /// Signal name such as `SIGTERM` when a pipe process was killed by one.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        signal: Option<String>,
        final_offset: u64,
        /// Pipe only: newlines in the output file. Omitted for PTYs.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        output_lines: Option<u64>,
        /// Same as `pipe.output_error`, so a waiter learns the output file is
        /// incomplete without another request.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        output_error: Option<String>,
        exited_at: u64,
    },
    ControllerChanged {
        attachment_id: Option<String>,
        generation: u64,
    },
    TitleChanged {
        title: String,
    },
    ForegroundProcessChanged {
        process: Option<String>,
    },
    Error {
        message: String,
    },
}

impl From<ProcessExit> for Response {
    fn from(exit: ProcessExit) -> Self {
        Response::Exited {
            exit_code: exit.exit_code,
            signal: exit.signal,
            final_offset: exit.final_offset,
            output_lines: exit.output_lines,
            output_error: exit.output_error,
            exited_at: exit.exited_at,
        }
    }
}

/// Reads a request envelope. A request this daemon cannot parse (an unknown
/// `op`, or bad fields) is returned as an error message for the client
/// rather than failing the connection, so clients can probe for requests.
pub fn read_envelope(reader: impl Read) -> Result<(String, Result<Request, String>)> {
    #[derive(Deserialize)]
    struct RawEnvelope {
        token: String,
        request: serde_json::Value,
    }
    let raw: RawEnvelope = read_frame(reader)?;
    let Some(op) = raw.request.get("op").and_then(serde_json::Value::as_str) else {
        return Ok((raw.token, Err("invalid request: missing field `op`".into())));
    };
    let op = op.to_string();
    // With only the tag, the one possible "unknown variant" is the op itself;
    // a bad enum value in a known request must not look like an unknown op.
    let known = serde_json::from_value::<Request>(serde_json::json!({ "op": op })).map_or_else(
        |error| !error.to_string().starts_with("unknown variant"),
        |_| true,
    );
    let request = if known {
        serde_json::from_value::<Request>(raw.request)
            .map_err(|error| format!("invalid {op} request: {error}"))
    } else {
        Err(format!("unsupported request: {op}"))
    };
    Ok((raw.token, request))
}

pub fn write_frame(mut writer: impl Write, value: &impl Serialize) -> Result<()> {
    let payload = serde_json::to_vec(value)?;
    if payload.len() > MAX_FRAME_BYTES {
        bail!("frame exceeds {MAX_FRAME_BYTES} byte limit");
    }
    let length = u32::try_from(payload.len()).context("frame length exceeds u32")?;
    writer.write_all(&length.to_be_bytes())?;
    writer.write_all(&payload)?;
    writer.flush()?;
    Ok(())
}

pub fn write_output_frame(
    mut writer: impl Write,
    start: u64,
    end: u64,
    bytes: &[u8],
) -> Result<()> {
    let payload_len = bytes
        .len()
        .checked_add(17)
        .context("output frame length overflow")?;
    if payload_len > MAX_FRAME_BYTES {
        bail!("frame exceeds {MAX_FRAME_BYTES} byte limit");
    }
    let length = u32::try_from(payload_len).context("frame length exceeds u32")?;
    writer.write_all(&length.to_be_bytes())?;
    writer.write_all(&[OUTPUT_FRAME_TAG])?;
    writer.write_all(&start.to_be_bytes())?;
    writer.write_all(&end.to_be_bytes())?;
    writer.write_all(bytes)?;
    writer.flush()?;
    Ok(())
}

#[derive(Debug)]
pub enum SubscriptionEvent {
    Output {
        start: u64,
        end: u64,
        bytes: Vec<u8>,
    },
    Response(Box<Response>),
}

pub fn read_subscription_event(mut reader: impl Read) -> Result<SubscriptionEvent> {
    let payload = read_payload(&mut reader)?;
    if payload.first() != Some(&OUTPUT_FRAME_TAG) {
        return serde_json::from_slice(&payload)
            .map(Box::new)
            .map(SubscriptionEvent::Response)
            .context("invalid protocol JSON");
    }
    if payload.len() < 17 {
        bail!("invalid output frame");
    }
    Ok(SubscriptionEvent::Output {
        start: u64::from_be_bytes(payload[1..9].try_into().expect("fixed start offset")),
        end: u64::from_be_bytes(payload[9..17].try_into().expect("fixed end offset")),
        bytes: payload[17..].to_vec(),
    })
}

pub fn read_frame<T: for<'de> Deserialize<'de>>(mut reader: impl Read) -> Result<T> {
    serde_json::from_slice(&read_payload(&mut reader)?).context("invalid protocol JSON")
}

fn read_payload(mut reader: impl Read) -> Result<Vec<u8>> {
    let mut length = [0_u8; 4];
    reader.read_exact(&mut length)?;
    let length = u32::from_be_bytes(length) as usize;
    if length > MAX_FRAME_BYTES {
        bail!("frame claims {length} bytes, limit is {MAX_FRAME_BYTES}");
    }
    let mut payload = vec![0_u8; length];
    reader.read_exact(&mut payload)?;
    Ok(payload)
}
#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::service::{PipeInfo, PtyInfo, TerminalLifecycle};

    fn request(value: serde_json::Value) -> Request {
        serde_json::from_value(value).unwrap()
    }

    /// Serializing must give back exactly the JSON that was parsed.
    fn round_trip<T: Serialize + for<'de> Deserialize<'de>>(value: serde_json::Value) -> T {
        let parsed = serde_json::from_value::<T>(value.clone()).unwrap();
        assert_eq!(serde_json::to_value(&parsed).unwrap(), value);
        parsed
    }

    #[test]
    fn version_8_has_no_features() {
        assert_eq!(PROTOCOL_VERSION, 8);
        assert!(features().is_empty());
        // `features` is required.
        assert!(
            serde_json::from_value::<Response>(
                json!({"type": "pong", "instance_id": "a", "pid": 1, "protocol": 8})
            )
            .is_err()
        );
        round_trip::<Response>(
            json!({"type": "pong", "instance_id": "a", "pid": 1, "protocol": 8, "features": []}),
        );
    }

    #[test]
    fn create_requests_take_only_their_own_fields() {
        let pty = json!({
            "op": "create_pty", "program": "sh", "args": ["-l"], "cwd": "/",
            "env": {"A": "1"}, "group_id": "g", "title": "t", "cols": 80, "rows": 24,
        });
        assert!(matches!(
            round_trip::<Request>(pty.clone()),
            Request::CreatePty {
                cols: 80,
                rows: 24,
                ..
            }
        ));
        for field in ["title", "cols", "rows", "group_id"] {
            let mut missing = pty.clone();
            missing.as_object_mut().unwrap().remove(field);
            assert!(
                serde_json::from_value::<Request>(missing).is_err(),
                "{field}"
            );
        }
        let pipe = json!({
            "op": "create_pipe", "program": "sh", "args": ["-c", "true"], "cwd": "/",
            "env": {}, "group_id": "g", "output_path": "/tmp/out",
            "metadata": {"command": "true", "nested": {"a": [1]}},
        });
        assert!(matches!(
            round_trip::<Request>(pipe.clone()),
            Request::CreatePipe { output_path, metadata, .. }
                if output_path == std::path::Path::new("/tmp/out") && metadata["command"] == "true"
        ));
        for field in ["output_path", "metadata", "env"] {
            let mut missing = pipe.clone();
            missing.as_object_mut().unwrap().remove(field);
            assert!(
                serde_json::from_value::<Request>(missing).is_err(),
                "{field}"
            );
        }
        let mut not_an_object = pipe.clone();
        not_an_object["metadata"] = json!("text");
        assert!(serde_json::from_value::<Request>(not_an_object).is_err());
        // The v7 `create` is gone.
        assert!(
            serde_json::from_value::<Request>(json!({
                "op": "create", "program": "sh", "args": [], "cwd": "/", "title": "t",
                "group_id": "g", "env": {}, "cols": 80, "rows": 24,
            }))
            .is_err()
        );
    }

    #[test]
    fn process_requests() {
        assert!(matches!(
            round_trip::<Request>(json!({"op": "list", "mode": "pipe"})),
            Request::List {
                mode: ProcessMode::Pipe
            }
        ));
        assert!(serde_json::from_value::<Request>(json!({"op": "list"})).is_err());
        assert!(matches!(
            round_trip::<Request>(json!({"op": "get", "id": 3})),
            Request::Get { id: 3 }
        ));
        assert!(matches!(
            round_trip::<Request>(json!({"op": "wait", "id": 3})),
            Request::Wait { id: 3 }
        ));
        for (name, signal) in [
            ("SIGTERM", ProcessSignal::Term),
            ("SIGINT", ProcessSignal::Int),
            ("SIGKILL", ProcessSignal::Kill),
        ] {
            assert!(matches!(
                round_trip::<Request>(json!({"op": "signal", "id": 3, "signal": name})),
                Request::Signal { id: 3, signal: parsed } if parsed == signal
            ));
        }
        assert!(
            serde_json::from_value::<Request>(json!({"op": "signal", "id": 3, "signal": "SIGHUP"}))
                .is_err()
        );
        assert!(matches!(
            round_trip::<Request>(json!({"op": "set_metadata", "id": 3, "metadata": {"a": 1}})),
            Request::SetMetadata { id: 3, metadata } if metadata["a"] == 1
        ));
        assert!(matches!(
            request(json!({"op": "read_rows", "id": 1})),
            Request::ReadRows { id: 1, rows: None }
        ));
        assert!(matches!(
            request(json!({"op": "rename", "id": 1})),
            Request::Rename { id: 1, title: None }
        ));
    }

    #[test]
    fn process_info_groups_by_mode() {
        let pty = json!({
            "id": 1, "mode": "pty", "pid": 10, "command": ["sh"], "cwd": "/",
            "group_id": "session", "lifecycle": {"status": "running"},
            "output_head": 0, "output_tail": 5, "started_at": 100, "exited_at": null,
            "pty": {
                "title": "sh", "user_title": null, "foreground_process": "vim",
                "cols": 80, "rows": 24,
            },
        });
        let info = round_trip::<ProcessInfo>(pty);
        assert!(info.pipe.is_none());
        assert!(matches!(info.pty, Some(PtyInfo { cols: 80, .. })));
        let pipe = json!({
            "id": 2, "mode": "pipe", "pid": 11, "command": ["sh", "-c", "ls"], "cwd": "/",
            "group_id": "project", "lifecycle": {"status": "exited", "exit_code": null, "signal": "SIGTERM"},
            "output_head": 7, "output_tail": 7, "started_at": 100, "exited_at": 200,
            "pipe": {
                "output_path": "/tmp/sh_1.out", "output_lines": 1,
                "output_error": "failed to write output file: disk full",
                "metadata": {"id": "sh_1"},
            },
        });
        let info = round_trip::<ProcessInfo>(pipe.clone());
        assert!(info.pty.is_none());
        assert!(matches!(
            info.pipe,
            Some(PipeInfo {
                output_lines: 1,
                ..
            })
        ));
        assert_eq!(
            info.lifecycle,
            TerminalLifecycle::Exited {
                exit_code: None,
                signal: Some("SIGTERM".into())
            }
        );
        // `output_error` is omitted when there is none.
        let mut clean = pipe;
        clean["pipe"]
            .as_object_mut()
            .unwrap()
            .remove("output_error");
        round_trip::<ProcessInfo>(clean.clone());
        // `mode` and the timestamps are required.
        for field in ["mode", "started_at"] {
            let mut missing = clean.clone();
            missing.as_object_mut().unwrap().remove(field);
            assert!(
                serde_json::from_value::<ProcessInfo>(missing).is_err(),
                "{field}"
            );
        }
    }

    #[test]
    fn responses_name_the_process() {
        let info = json!({
            "id": 1, "mode": "pty", "pid": null, "command": [], "cwd": "/",
            "group_id": "g", "lifecycle": {"status": "running"},
            "output_head": 0, "output_tail": 0, "started_at": 1, "exited_at": null,
            "pty": {"title": "t", "user_title": null, "foreground_process": null, "cols": 1, "rows": 1},
        });
        for value in [
            json!({"type": "created", "process": info}),
            json!({"type": "process", "process": info}),
            json!({"type": "processes", "processes": [info]}),
            json!({"type": "snapshot", "process": info, "text": "", "checkpoint_base64": "", "cursor_x": 0, "cursor_y": 0}),
            json!({"type": "rows", "process": info, "lines": [], "cursor_x": 0, "cursor_y": 0}),
            json!({
                "type": "attached", "process": info, "role": "observer", "generation": 0,
                "requested_offset": 0, "available_offset": 0, "end_offset": 0,
                "truncated": false, "replay_base64": "",
            }),
        ] {
            round_trip::<Response>(value);
        }
    }

    #[test]
    fn exited_carries_lines_only_for_pipes() {
        let pty = json!({"type": "exited", "exit_code": 0, "final_offset": 3, "exited_at": 9});
        assert!(matches!(
            round_trip::<Response>(pty),
            Response::Exited {
                output_lines: None,
                exited_at: 9,
                ..
            }
        ));
        let pipe = json!({
            "type": "exited", "exit_code": null, "signal": "SIGKILL", "final_offset": 3,
            "output_lines": 2, "output_error": "failed", "exited_at": 9,
        });
        round_trip::<Response>(pipe);
        assert!(
            serde_json::from_value::<Response>(
                json!({"type": "exited", "exit_code": 0, "final_offset": 3})
            )
            .is_err()
        );
    }

    #[test]
    fn unknown_requests_are_reported_not_fatal() {
        let parse = |request: serde_json::Value| {
            let mut frame = Vec::new();
            write_frame(&mut frame, &json!({"token": "t", "request": request})).unwrap();
            read_envelope(frame.as_slice()).unwrap()
        };
        let (token, request) = parse(json!({"op": "teleport", "id": 1}));
        assert_eq!(token, "t");
        assert_eq!(request.unwrap_err(), "unsupported request: teleport");
        let (_, request) = parse(json!({"op": "get"}));
        assert!(request.unwrap_err().starts_with("invalid get request"));
        let (_, request) = parse(json!({"op": "signal", "id": 1, "signal": "SIGHUP"}));
        assert!(
            request
                .unwrap_err()
                .starts_with("invalid signal request: unknown variant `SIGHUP`")
        );
        let (_, request) = parse(json!({"op": "list", "mode": "bogus"}));
        assert!(request.unwrap_err().starts_with("invalid list request"));
        let (_, request) = parse(json!({"id": 1}));
        assert_eq!(request.unwrap_err(), "invalid request: missing field `op`");
        let (_, request) = parse(json!({"op": 3}));
        assert_eq!(request.unwrap_err(), "invalid request: missing field `op`");
        let (_, request) = parse(json!({"op": "ping"}));
        assert!(matches!(request, Ok(Request::Ping)));
        // A frame that is not an envelope at all still fails the connection.
        let mut frame = Vec::new();
        write_frame(&mut frame, &json!({"request": {"op": "ping"}})).unwrap();
        assert!(read_envelope(frame.as_slice()).is_err());
    }
}
