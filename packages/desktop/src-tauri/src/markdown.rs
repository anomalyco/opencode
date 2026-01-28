use comrak::{create_formatter, parse_document, Arena, Options, html::ChildRendering, nodes::NodeValue};
use std::fmt::Write;

create_formatter!(ExternalLinkFormatter, {
    NodeValue::Link(ref nl) => |context, node, entering| {
        let skip = context.options.parse.relaxed_autolinks
            && node.parent().is_some_and(|p| comrak::node_matches!(p, NodeValue::Link(..)));
        if skip {
            return Ok(ChildRendering::HTML);
        }

        if entering {
            context.write_str("<a")?;
            comrak::html::render_sourcepos(context, node)?;

            context.write_str(" href=\"")?;
            let url = &nl.url;
            if context.options.render.r#unsafe || !comrak::html::dangerous_url(url) {
                if let Some(rewriter) = &context.options.extension.link_url_rewriter {
                    context.escape_href(&rewriter.to_html(url))?;
                } else {
                    context.escape_href(url)?;
                }
            }
            context.write_str("\"")?;

            if !nl.title.is_empty() {
                context.write_str(" title=\"")?;
                context.escape(&nl.title)?;
                context.write_str("\"")?;
            }

            context.write_str(
                " class=\"external-link\" target=\"_blank\" rel=\"noopener noreferrer\">",
            )?;
        } else {
            context.write_str("</a>")?;
        }
    },
});

pub fn parse_markdown(input: &str) -> String {
    let mut options = Options::default();
    options.extension.strikethrough = true;
    options.extension.table = true;
    options.extension.tasklist = true;
    options.extension.autolink = true;
    options.render.r#unsafe = true;

    let arena = Arena::new();
    let doc = parse_document(&arena, input, &options);
    let mut html = String::new();
    ExternalLinkFormatter::format_document(doc, &options, &mut html).unwrap_or_default();
    html
}

#[tauri::command]
pub async fn parse_markdown_command(markdown: String) -> Result<String, String> {
    Ok(parse_markdown(&markdown))
}
