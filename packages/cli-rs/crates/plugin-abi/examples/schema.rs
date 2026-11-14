//! Prints the JSON Schema of plugin contract 2.0; `script/gen/plugin-schema.ts` writes it to `schema/v2.json`.

fn main() {
    println!("{}", serde_json::to_string_pretty(&opencode_plugin_abi::v2::schema()).unwrap());
}
