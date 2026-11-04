//! `models`: list the available models (`packages/cli/src/commands/handlers/models.ts`).

use serde_json::Value;

use super::Context;
use super::client::{block_on, connect, get_located, locale_compare};

pub fn run(context: &Context) -> anyhow::Result<()> {
    let response = block_on(async {
        let server = connect(context).await?;
        get_located(&server.client, "/api/model", &[400, 401, 404, 503]).await
    })??;
    let mut models: Vec<String> = data(&response)
        .iter()
        .map(|model| format!("{}/{}", text(&model["providerID"]), text(&model["id"])))
        .collect();
    models.sort_by(|a, b| locale_compare(a, b));
    if models.is_empty() {
        return Ok(());
    }
    crate::output::print(&(models.join("\n") + "\n"))
}

/// `response.data` of a `{ location, data: [...] }` list.
pub fn data(response: &Value) -> &[Value] {
    response["data"].as_array().map_or(&[], Vec::as_slice)
}

// A value in a template string: a string as it is, a missing field as `undefined`.
fn text(value: &Value) -> String {
    match value {
        Value::String(value) => value.clone(),
        Value::Null => "undefined".to_owned(),
        value => value.to_string(),
    }
}
