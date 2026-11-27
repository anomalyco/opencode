//! What an init or event step returns (`specs/v2/widgets.md`, Step ABI), as the decoder yields it: Rune's
//! `StepOutput`, with its JSON reading ([`StepOutput::from_value`]) for comparison.

use serde::{Deserialize, Deserializer};
use serde_json::Value;

use crate::node::Node;

/// Deserializes a field that is there, `null` included, as `Some`: `submit: null` submits null.
fn present<'de, D: Deserializer<'de>>(d: D) -> Result<Option<Value>, D::Error> {
    Value::deserialize(d).map(Some)
}

#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct StepOutput {
    #[serde(default)]
    pub state: Value,
    pub view: Node,
    /// Present: the user submitted this value.
    #[serde(default, deserialize_with = "present")]
    pub submit: Option<Value>,
    /// Present (and true): the user dismissed the widget.
    #[serde(default)]
    pub dismiss: bool,
    /// Present: a message to the agent; the widget stays open.
    #[serde(default)]
    pub send: Option<SendMessage>,
}

/// A non-final message to the agent (`send(value, { wake })`).
#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct SendMessage {
    #[serde(default)]
    pub value: Value,
    /// Whether it starts the agent's turn (true unless the widget template said otherwise).
    #[serde(default = "yes")]
    pub wake: bool,
}

fn yes() -> bool {
    true
}

impl StepOutput {
    /// Reads a step's return value from JSON, or why it isn't a valid step output.
    pub fn from_value(v: &Value) -> Result<StepOutput, String> {
        if !v.is_object() {
            return Err("a step must return an object with state and view".into());
        }
        let out = StepOutput::deserialize(v).map_err(|e| format!("invalid step output: {e}"))?;
        out.view.check()?;
        Ok(out)
    }
}
