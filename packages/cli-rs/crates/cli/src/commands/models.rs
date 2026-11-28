use opencode_api::client::Client;
use opencode_api::generated::{ModelListInput, RpcCallInput};
use opencode_util::error;
use serde_json::Value;

use super::Context;
use super::client::{block_on, connect, here, locale_compare};

pub fn run(context: &Context) -> error::Result<()> {
    let response = block_on(async {
        let server = connect(context).await?;
        let location = Some(here()?);
        super::client::wait_for_plugins(&server.client, location.clone()).await;
        // Plugins can publish models after activation. A one-shot command would miss those updates.
        let status = RpcCallInput {
            rpc_id: "experimental.model-discovery".into(),
            method: "ready".into(),
            location: location.clone(),
            input: None,
        };
        let _ = tokio::time::timeout(std::time::Duration::from_secs(10), async {
            while let Ok(status) = server.client.rpc_call(&status).await {
                if status.output != Some(Value::Bool(false)) {
                    break;
                }
                tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            }
        })
        .await;
        let input = ModelListInput { location, types: None };
        Ok::<_, error::Error>(server.client.json::<Value>(Client::model_list_call(&input)?).await?)
    })??;
    let mut models: Vec<String> =
        data(&response).iter().map(|model| format!("{}/{}", text(&model["providerID"]), text(&model["id"]))).collect();
    models.sort_by(|a, b| locale_compare(a, b));
    if models.is_empty() {
        return Ok(());
    }
    crate::output::print(&opencode_ui::terminal_text(&(models.join("\n") + "\n")))
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
