use comrak::{markdown_to_html, Options};

pub fn parse_markdown(input: &str) -> String {
    let mut options = Options::default();
    options.extension.strikethrough = true;
    options.extension.table = true;
    options.extension.tasklist = true;
    options.extension.autolink = true;
    options.render.r#unsafe = true;

    markdown_to_html(input, &options)
}

#[tauri::command]
pub async fn parse_markdown_command(markdown: String) -> Result<String, String> {
    Ok(parse_markdown(&markdown))
}
