use std::io::{Read, Write};
use std::path::PathBuf;

use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};

use crate::service::{TerminalId, TerminalInfo};

pub const PROTOCOL_VERSION: u32 = 7;
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
    Create {
        program: String,
        args: Vec<String>,
        cwd: PathBuf,
        title: String,
        group_id: String,
        env: std::collections::HashMap<String, String>,
        cols: u16,
        rows: u16,
    },
    List,
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
    },
    Created {
        terminal: TerminalInfo,
    },
    Terminals {
        terminals: Vec<TerminalInfo>,
    },
    Ok,
    Snapshot {
        terminal: TerminalInfo,
        text: String,
        checkpoint_base64: String,
        cursor_x: u16,
        cursor_y: u16,
    },
    Rows {
        terminal: TerminalInfo,
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
        terminal: TerminalInfo,
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
        final_offset: u64,
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
    use super::*;

    #[test]
    fn read_rows_accepts_optional_height_and_u16_counts() {
        for json in [
            r#"{"op":"read_rows","id":1}"#,
            r#"{"op":"read_rows","id":1,"rows":null}"#,
        ] {
            assert!(matches!(
                serde_json::from_str::<Request>(json).unwrap(),
                Request::ReadRows { id: 1, rows: None }
            ));
        }
        for rows in [0, 1, u16::MAX] {
            let value = serde_json::to_value(Request::ReadRows {
                id: 1,
                rows: Some(rows),
            })
            .unwrap();
            assert_eq!(
                value,
                serde_json::json!({"op": "read_rows", "id": 1, "rows": rows})
            );
            assert!(
                matches!(serde_json::from_value::<Request>(value).unwrap(), Request::ReadRows { rows: Some(count), .. } if count == rows)
            );
        }
        for rows in [-1, 65536] {
            assert!(
                serde_json::from_value::<Request>(
                    serde_json::json!({"op": "read_rows", "id": 1, "rows": rows})
                )
                .is_err()
            );
        }
        assert_eq!(PROTOCOL_VERSION, 7);
    }
}
