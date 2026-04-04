use comrak::{
    Arena, Options, create_formatter, html::ChildRendering, nodes::NodeValue, parse_document,
};
use std::fmt::Write;
use std::time::Instant;

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

fn escape_html(input: &str) -> String {
    input
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

fn fence(line: &str) -> Option<(char, usize)> {
    let body = line.trim_end_matches(['\r', '\n']);
    let trimmed = body.trim_start_matches(' ');
    let indent = body.len().saturating_sub(trimmed.len());
    if indent > 3 {
        return None;
    }

    let ch = trimmed.chars().next()?;
    if ch != '`' && ch != '~' {
        return None;
    }

    let size = trimmed.chars().take_while(|c| *c == ch).count();
    if size < 3 {
        return None;
    }

    Some((ch, size))
}

fn protect_math_blocks(input: &str) -> String {
    let mut out = String::new();
    let lines = input.split_inclusive('\n').collect::<Vec<_>>();
    let mut i = 0;
    let mut code = None;

    while i < lines.len() {
        let line = lines[i];

        if let Some((ch, size)) = code {
            if let Some((next, count)) = fence(line) {
                if next == ch && count >= size {
                    code = None;
                }
            }
            out.push_str(line);
            i += 1;
            continue;
        }

        if let Some(next) = fence(line) {
            code = Some(next);
            out.push_str(line);
            i += 1;
            continue;
        }

        let body = line.trim_end_matches(['\r', '\n']).trim();
        let close = if body == "$$" {
            Some("$$")
        } else if body == "\\[" {
            Some("\\]")
        } else {
            None
        };

        let Some(close) = close else {
            out.push_str(line);
            i += 1;
            continue;
        };

        let mut math = String::new();
        let mut j = i + 1;
        let mut found = false;

        while j < lines.len() {
            let next = lines[j];
            let body = next.trim_end_matches(['\r', '\n']).trim();
            if body == close {
                found = true;
                break;
            }
            math.push_str(next);
            j += 1;
        }

        if !found {
            out.push_str(line);
            i += 1;
            continue;
        }

        if !out.is_empty() && !out.ends_with("\n\n") {
            if !out.ends_with('\n') {
                out.push('\n');
            }
            out.push('\n');
        }

        out.push_str("<div data-opencode-math-style=\"display\">");
        out.push_str(&escape_html(&math));
        out.push_str("</div>\n\n");
        i = j + 1;
    }

    if !input.ends_with('\n') && out.ends_with('\n') {
        out.pop();
    }

    out
}

fn parse_markdown_profile(input: &str) -> (String, u128, u128, u128) {
    let mut options = Options::default();
    options.extension.strikethrough = true;
    options.extension.table = true;
    options.extension.tasklist = true;
    options.extension.autolink = true;
    options.extension.math_dollars = true;
    options.render.r#unsafe = true;

    let arena = Arena::new();
    let protect_start = Instant::now();
    let input = protect_math_blocks(input);
    let protect_elapsed = protect_start.elapsed().as_millis();
    let parse_start = Instant::now();
    let doc = parse_document(&arena, &input, &options);
    let parse_elapsed = parse_start.elapsed().as_millis();
    let mut html = String::new();
    let render_start = Instant::now();
    ExternalLinkFormatter::format_document(doc, &options, &mut html).unwrap_or_default();
    let render_elapsed = render_start.elapsed().as_millis();
    (html, protect_elapsed, parse_elapsed, render_elapsed)
}

pub fn parse_markdown(input: &str) -> String {
    parse_markdown_profile(input).0
}

#[tauri::command]
#[specta::specta]
pub async fn parse_markdown_command(markdown: String) -> Result<String, String> {
    Ok(parse_markdown_profile(&markdown).0)
}

#[cfg(test)]
mod tests {
    use super::{parse_markdown, protect_math_blocks};

    #[test]
    fn keeps_block_math_intact() {
        let html = parse_markdown(
            r#"
$$
\sum_{p\in\mathbb Z}\frac{e^{2\pi i p x}}{1-e^{2\pi i y}q^p}
=
i\,
\frac{\vartheta_1(x+y|\tau)\eta(\tau)^3}{\vartheta_1(x|\tau)\vartheta_1(y|\tau)}
$$
"#,
        );

        assert!(html.contains("<div data-opencode-math-style=\"display\">"));
        assert!(html.contains("=\ni\\,\n"));
        assert!(!html.contains("<h1>"));
    }

    #[test]
    fn skips_fenced_code() {
        let html = protect_math_blocks(
            r#"
```tex
$$
a=b
$$
```
"#,
        );

        assert!(html.contains("```tex"));
        assert!(html.contains("a=b"));
        assert!(!html.contains("data-opencode-math-style"));
    }

    #[test]
    fn keeps_list_items_after_block_math() {
        let html = parse_markdown(
            r#"- 当前生成元集合升级为
$$
\{J,G,\widetilde G,T,W^+,W^-,B_1,B_2,B_3,\Phi_+,\Phi_-\}
$$
- weight $5/2$ 的 $\Phi_\pm$ 被确认为必备新生成元
- 新增了两个扫描脚本：
  - `Notebooks/check_small_z3_phi_weight3_closure.py`
  - `Notebooks/check_small_z3_phi_weight4_closure.py`
"#,
        );

        assert!(html.contains("<div data-opencode-math-style=\"display\">"));
        assert!(html.contains("weight <span data-math-style=\"inline\">5/2</span>"));
        assert!(html.contains("<li>新增了两个扫描脚本："));
        assert!(html.contains("check_small_z3_phi_weight4_closure.py"));
    }
}
