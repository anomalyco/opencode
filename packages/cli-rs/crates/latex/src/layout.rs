//! Terminal-cell layout of a parsed formula, a port of `packages/latex/src/layout.ts`.

use unicode_segmentation::UnicodeSegmentation;

use crate::parse::{Accent, Align, Environment, Node, Role, Variant};

/// How a cell is styled. The color is the name or value `\textcolor` gave.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Style {
    pub color: Option<String>,
    pub bold: bool,
    pub italic: bool,
    pub dim: bool,
}

/// One grapheme of a formula and its style.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Cell {
    pub text: String,
    pub style: Style,
}

/// A laid-out formula (TS `MathLayout`): rows of cells, `None` where nothing is drawn. A wide grapheme leaves the
/// cell after it empty.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Layout {
    pub width: usize,
    pub height: usize,
    /// The row neighbors align on: a fraction's rule or the middle of a matrix.
    pub baseline: usize,
    pub cells: Vec<Vec<Option<Cell>>>,
}

impl std::fmt::Display for Layout {
    /// The rows as text with trailing blanks trimmed (TS `toString`).
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let rows: Vec<String> = self
            .cells
            .iter()
            .map(|row| {
                let mut output = String::new();
                let mut x = 0;
                while x < self.width {
                    match &row[x] {
                        Some(cell) => {
                            output.push_str(&cell.text);
                            x += cell_width(&cell.text).max(1) as usize;
                        }
                        None => {
                            output.push(' ');
                            x += 1;
                        }
                    }
                }
                output.trim_end().to_owned()
            })
            .collect();
        f.write_str(&rows.join("\n"))
    }
}

/// Layout options (TS `RenderLatexOptions`); the plugin uses the defaults.
#[derive(Clone, Debug)]
pub struct Options {
    /// Operator limits above and below, as display math sets them.
    pub display: bool,
    /// Unicode super- and subscript characters where every script character has one.
    pub compact_scripts: bool,
    pub color: Option<String>,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            display: true,
            compact_scripts: true,
            color: None,
        }
    }
}

pub fn layout(node: &Node, options: &Options) -> Layout {
    let context = Context {
        display: options.display,
        compact: options.compact_scripts,
        style: Style {
            color: options.color.clone(),
            ..Style::default()
        },
        variant: None,
    };
    let block = layout_node(node, &context);
    Layout {
        width: block.width as usize,
        height: block.height as usize,
        baseline: block.baseline as usize,
        cells: block.cells,
    }
}

#[derive(Clone)]
struct Context {
    display: bool,
    compact: bool,
    style: Style,
    variant: Option<Variant>,
}

/// TS `Box`.
struct Block {
    width: i32,
    height: i32,
    baseline: i32,
    cells: Vec<Vec<Option<Cell>>>,
}

fn layout_node(node: &Node, context: &Context) -> Block {
    match node {
        Node::Row(body) => layout_row(body, context),
        Node::Symbol { value, .. } | Node::Text(value) | Node::Operator { value, .. } => {
            text_box(&apply_variant(value, context.variant), &context.style)
        }
        Node::Space(width) => blank(*width as i32, 1, 0),
        Node::Fraction {
            numerator,
            denominator,
            bar,
            align,
        } => layout_fraction(numerator, denominator, *bar, *align, context),
        Node::Root { body, index } => layout_root(body, index.as_deref(), context),
        Node::Scripts {
            base,
            superscript,
            subscript,
        } => layout_scripts(base, superscript.as_deref(), subscript.as_deref(), context),
        Node::Delimited { left, body, right } => layout_delimited(left, body, right, context),
        Node::Matrix {
            rows,
            environment,
            columns,
        } => layout_matrix(rows, *environment, columns.as_deref(), context),
        Node::Brace { body, over } => layout_brace(body, *over, context),
        Node::Accent { accent, body } => layout_accent(*accent, body, context),
        Node::Variant { variant, body } => layout_node(body, &with_variant(context, *variant)),
        Node::OverUnder { base, over, under } => {
            layout_over_under(base, over.as_deref(), under.as_deref(), context)
        }
        Node::Color { color, body } => {
            let mut context = context.clone();
            context.style.color = Some(color.clone());
            layout_node(body, &context)
        }
    }
}

fn layout_row(nodes: &[Node], context: &Context) -> Block {
    if nodes.is_empty() {
        return blank(0, 1, 0);
    }
    let mut blocks = Vec::new();
    let mut previous: Option<Role> = None;
    for (index, node) in nodes.iter().enumerate() {
        let role = normalize_binary(
            node_role(node),
            previous,
            next_significant_role(&nodes[index + 1..]),
        );
        if needs_space(previous, role, blocks.len()) {
            blocks.push(blank(1, 1, 0));
        }
        blocks.push(layout_node(node, context));
        if !matches!(node, Node::Space(_)) {
            previous = Some(role.unwrap_or(Role::Ordinary));
        }
    }
    hpack(blocks)
}

fn layout_fraction(
    numerator: &Node,
    denominator: &Node,
    bar: bool,
    align: Option<Align>,
    context: &Context,
) -> Block {
    let numerator = layout_node(numerator, context);
    let denominator = layout_node(denominator, context);
    let width = numerator.width.max(denominator.width) + 2;
    // Barless fractions (binomials) still reserve an axis row so surrounding atoms and their stretching
    // parentheses align between the two entries.
    let gap = 1;
    let height = numerator.height + denominator.height + gap;
    // TeX places a fraction's math axis on its rule (or the equivalent empty axis row for a binomial).
    let baseline = numerator.height;
    let mut result = blank(width, height, baseline);
    let numerator_x = match align {
        Some(Align::Left) => 1,
        Some(Align::Right) => width - numerator.width - 1,
        None => (width - numerator.width) / 2,
    };
    overlay(&mut result, &numerator, numerator_x, 0);
    if bar {
        draw_horizontal(&mut result, numerator.height, 0, width, "─", &context.style);
    }
    overlay(
        &mut result,
        &denominator,
        (width - denominator.width) / 2,
        numerator.height + gap,
    );
    result
}

fn layout_root(body: &Node, index: Option<&Node>, context: &Context) -> Block {
    let body = layout_node(body, context);
    let index = index.map(|index| layout_node(index, context));
    let index_width = index.as_ref().map_or(0, |index| (index.width - 1).max(0));
    // The index ends beside the overbar, never inside the hook or radicand.
    let top = (index.as_ref().map_or(1, |index| index.height) - 1).max(0);
    let body_x = index_width + 2;
    let width = body_x + body.width;
    let height = top + body.height + 1;
    let baseline = top + body.baseline + 1;
    let mut result = blank(width, height, baseline);
    let style = &context.style;
    set_cell(&mut result, body_x - 1, top, "╭", style);
    draw_horizontal(&mut result, top, body_x, body.width, "─", style);
    for y in top + 1..height - 1 {
        set_cell(&mut result, body_x - 1, y, "│", style);
    }
    set_cell(&mut result, body_x - 2, height - 1, "╰", style);
    set_cell(&mut result, body_x - 1, height - 1, "╯", style);
    overlay(&mut result, &body, body_x, top + 1);
    if let Some(index) = &index {
        overlay(&mut result, index, 0, 0);
    }
    result
}

fn layout_scripts(
    base: &Node,
    superscript: Option<&Node>,
    subscript: Option<&Node>,
    context: &Context,
) -> Block {
    let present = |node: &Node| simple_text(node).as_deref() != Some("");
    let (superscript, subscript) = (
        superscript.filter(|n| present(n)),
        subscript.filter(|n| present(n)),
    );
    if matches!(base, Node::Brace { .. })
        || (matches!(base, Node::Operator { limits: true, .. }) && context.display)
    {
        return layout_over_under(base, superscript, subscript, context);
    }

    let base = layout_node(base, context);
    if context.compact && base.height == 1 {
        let compact = |node: Option<&Node>, table: &[(char, char)]| match node {
            Some(node) => simple_text(node).and_then(|text| map_script(&text, table)),
            None => Some(String::new()),
        };
        if let (Some(superscript), Some(subscript)) = (
            compact(superscript, SUPERSCRIPTS),
            compact(subscript, SUBSCRIPTS),
        ) {
            let scripts = text_box(&(superscript + &subscript), &context.style);
            return hpack(vec![base, scripts]);
        }
    }

    let superscript = superscript.map(|node| layout_node(node, context));
    let subscript = subscript.map(|node| layout_node(node, context));
    let script_width = superscript
        .as_ref()
        .map_or(0, |s| s.width)
        .max(subscript.as_ref().map_or(0, |s| s.width));
    let top = superscript.as_ref().map_or(0, |s| s.height);
    let bottom = subscript.as_ref().map_or(0, |s| s.height);
    let mut result = blank(
        base.width + script_width,
        top + base.height + bottom,
        top + base.baseline,
    );
    overlay(&mut result, &base, 0, top);
    if let Some(superscript) = &superscript {
        overlay(&mut result, superscript, base.width, 0);
    }
    if let Some(subscript) = &subscript {
        overlay(&mut result, subscript, base.width, top + base.height);
    }
    result
}

fn layout_over_under(
    base: &Node,
    over: Option<&Node>,
    under: Option<&Node>,
    context: &Context,
) -> Block {
    let base = layout_node(base, context);
    let over = over.map(|node| layout_node(node, context));
    let under = under.map(|node| layout_node(node, context));
    let width = base
        .width
        .max(over.as_ref().map_or(0, |b| b.width))
        .max(under.as_ref().map_or(0, |b| b.width));
    let over_height = over.as_ref().map_or(0, |b| b.height);
    let height = over_height + base.height + under.as_ref().map_or(0, |b| b.height);
    let mut result = blank(width, height, over_height + base.baseline);
    if let Some(over) = &over {
        overlay(&mut result, over, (width - over.width) / 2, 0);
    }
    overlay(&mut result, &base, (width - base.width) / 2, over_height);
    if let Some(under) = &under {
        overlay(
            &mut result,
            under,
            (width - under.width) / 2,
            over_height + base.height,
        );
    }
    result
}

fn layout_delimited(left: &str, body: &Node, right: &str, context: &Context) -> Block {
    let body = layout_node(body, context);
    let left = delimiter_box(left, body.height, body.baseline, true, &context.style);
    let right = delimiter_box(right, body.height, body.baseline, false, &context.style);
    hpack(vec![left, body, right])
}

fn layout_matrix(
    rows: &[Vec<Node>],
    environment: Environment,
    columns: Option<&str>,
    context: &Context,
) -> Block {
    let cell_rows: Vec<Vec<Block>> = rows
        .iter()
        .map(|row| row.iter().map(|cell| layout_node(cell, context)).collect())
        .collect();
    let alignments: Option<Vec<char>> =
        columns.map(|columns| columns.chars().filter(|c| "lcr".contains(*c)).collect());
    let rules: Vec<i32> = columns.map_or_else(Vec::new, |columns| {
        columns
            .split(['l', 'c', 'r'])
            .map(|rule| rule.chars().count() as i32)
            .collect()
    });
    let column_count = cell_rows
        .iter()
        .map(Vec::len)
        .chain(alignments.as_ref().map(Vec::len))
        .max()
        .unwrap_or(0);
    let column_widths: Vec<i32> = (0..column_count)
        .map(|column| {
            cell_rows
                .iter()
                .filter_map(|row| row.get(column))
                .map(|cell| cell.width)
                .max()
                .unwrap_or(0)
        })
        .collect();
    let ascents: Vec<i32> = cell_rows
        .iter()
        .map(|row| {
            row.iter()
                .map(|cell| cell.baseline)
                .max()
                .unwrap_or(0)
                .max(0)
        })
        .collect();
    let descents: Vec<i32> = cell_rows
        .iter()
        .map(|row| {
            row.iter()
                .map(|cell| cell.height - cell.baseline - 1)
                .max()
                .unwrap_or(0)
                .max(0)
        })
        .collect();
    let row_heights: Vec<i32> = ascents
        .iter()
        .zip(&descents)
        .map(|(ascent, descent)| ascent + 1 + descent)
        .collect();
    let aligned = matches!(environment, Environment::Aligned | Environment::Align);
    let column_gap = if environment == Environment::Cases || aligned {
        2
    } else {
        1
    };
    let gaps: Vec<i32> = (0..=column_count)
        .map(|boundary| {
            let edge = boundary == 0 || boundary == column_count;
            match rules.get(boundary).copied().filter(|&rule| rule > 0) {
                Some(rule) => rule + if edge { 1 } else { 2 },
                None if edge => 0,
                None => column_gap,
            }
        })
        .collect();
    let width = column_widths.iter().sum::<i32>() + gaps.iter().sum::<i32>();
    let height = (row_heights.iter().sum::<i32>() + (rows.len() as i32 - 1).max(0)).max(1);
    let mut result = blank(width, height, height / 2);

    let mut y = 0;
    for (row_index, cells) in cell_rows.iter().enumerate() {
        let mut x = gaps[0];
        for column in 0..column_count {
            let column_width = column_widths[column];
            if let Some(cell) = cells.get(column) {
                let alignment = alignments
                    .as_ref()
                    .and_then(|a| a.get(column).copied())
                    .unwrap_or(match (environment, aligned) {
                        (Environment::Cases, _) => 'l',
                        (_, true) if column % 2 == 0 => 'r',
                        (_, true) => 'l',
                        _ => 'c',
                    });
                let cell_x = x + match alignment {
                    'l' => 0,
                    'r' => column_width - cell.width,
                    _ => (column_width - cell.width) / 2,
                };
                overlay(
                    &mut result,
                    cell,
                    cell_x,
                    y + ascents[row_index] - cell.baseline,
                );
            }
            x += column_width + gaps[column + 1];
        }
        y += row_heights[row_index] + 1;
    }

    let mut boundary_x = 0;
    for (boundary, gap) in gaps.iter().enumerate() {
        for rule in 0..rules.get(boundary).copied().unwrap_or(0) {
            for row in 0..height {
                let x = boundary_x + i32::from(boundary != 0) + rule;
                set_cell(&mut result, x, row, "│", &context.style);
            }
        }
        boundary_x += gap + column_widths.get(boundary).copied().unwrap_or(0);
    }

    let Some((left, right)) = matrix_delimiters(environment) else {
        return result;
    };
    let baseline = result.baseline;
    hpack(vec![
        delimiter_box(left, height, baseline, true, &context.style),
        result,
        delimiter_box(right, height, baseline, false, &context.style),
    ])
}

fn layout_brace(body: &Node, over: bool, context: &Context) -> Block {
    let body = layout_node(body, context);
    let width = body.width.max(3);
    let mut result = blank(width, body.height + 1, body.baseline + i32::from(over));
    let y = if over { 0 } else { body.height };
    overlay(
        &mut result,
        &body,
        (width - body.width) / 2,
        i32::from(over),
    );
    let style = &context.style;
    draw_horizontal(&mut result, y, 0, width, "─", style);
    set_cell(&mut result, 0, y, if over { "╭" } else { "╰" }, style);
    set_cell(
        &mut result,
        width - 1,
        y,
        if over { "╮" } else { "╯" },
        style,
    );
    set_cell(
        &mut result,
        (width - 1) / 2,
        y,
        if over { "┴" } else { "┬" },
        style,
    );
    result
}

fn layout_accent(accent: Accent, body: &Node, context: &Context) -> Block {
    let body = layout_node(body, context);
    let style = &context.style;
    if accent == Accent::Underline {
        let mut result = blank(body.width, body.height + 1, body.baseline);
        overlay(&mut result, &body, 0, 0);
        draw_horizontal(&mut result, body.height, 0, body.width, "─", style);
        return result;
    }

    let mut result = blank(body.width, body.height + 1, body.baseline + 1);
    overlay(&mut result, &body, 0, 1);
    let mark = match accent {
        Accent::Hat | Accent::Widehat if body.width == 1 => "^",
        Accent::Hat | Accent::Widehat => "⌢",
        Accent::Bar | Accent::Overline => "─",
        Accent::Vec => "→",
        Accent::Tilde => "~",
        Accent::Dot => "·",
        Accent::Ddot | Accent::Underline => "¨",
    };
    if matches!(accent, Accent::Bar | Accent::Overline) {
        draw_horizontal(&mut result, 0, 0, body.width, mark, style);
    } else {
        set_cell(
            &mut result,
            ((body.width - cell_width(mark)) / 2).max(0),
            0,
            mark,
            style,
        );
    }
    result
}

fn delimiter_box(delimiter: &str, height: i32, baseline: i32, left: bool, style: &Style) -> Block {
    if delimiter.is_empty() {
        return blank(0, height, baseline);
    }
    if height <= 1 {
        return text_box(delimiter, style);
    }
    let glyphs = delimiter_glyphs(delimiter);
    let width = glyphs
        .iter()
        .map(|glyph| cell_width(glyph))
        .max()
        .unwrap_or(0);
    let mut result = blank(width, height, baseline);
    for y in 0..height {
        let glyph = match y {
            0 => glyphs[0],
            y if y == height - 1 => glyphs[2],
            _ => glyphs[1],
        };
        set_cell(&mut result, 0, y, glyph, style);
    }
    if (delimiter == "{" || delimiter == "}") && height >= 3 {
        set_cell(
            &mut result,
            0,
            height / 2,
            if left { "⎨" } else { "⎬" },
            style,
        );
    }
    result
}

fn delimiter_glyphs(delimiter: &str) -> [&str; 3] {
    match delimiter {
        "(" => ["⎛", "⎜", "⎝"],
        ")" => ["⎞", "⎟", "⎠"],
        "[" => ["⎡", "⎢", "⎣"],
        "]" => ["⎤", "⎥", "⎦"],
        "{" => ["⎧", "⎪", "⎩"],
        "}" => ["⎫", "⎪", "⎭"],
        "⌊" => ["│", "│", "⌊"],
        "⌋" => ["│", "│", "⌋"],
        "⌈" => ["⌈", "│", "│"],
        "⌉" => ["⌉", "│", "│"],
        "⟨" => ["/", "│", "\\"],
        "⟩" => ["\\", "│", "/"],
        _ => [delimiter, delimiter, delimiter],
    }
}

fn matrix_delimiters(environment: Environment) -> Option<(&'static str, &'static str)> {
    Some(match environment {
        Environment::Pmatrix => ("(", ")"),
        Environment::Bmatrix => ("[", "]"),
        Environment::BigBmatrix => ("{", "}"),
        Environment::Vmatrix => ("│", "│"),
        Environment::BigVmatrix => ("║", "║"),
        Environment::Cases => ("{", ""),
        _ => return None,
    })
}

fn hpack(blocks: Vec<Block>) -> Block {
    if blocks.is_empty() {
        return blank(0, 1, 0);
    }
    let ascent = blocks.iter().map(|block| block.baseline).max().unwrap_or(0);
    let descent = blocks
        .iter()
        .map(|block| block.height - block.baseline - 1)
        .max()
        .unwrap_or(0);
    let width = blocks.iter().map(|block| block.width).sum();
    let mut result = blank(width, ascent + descent + 1, ascent);
    let mut x = 0;
    for block in &blocks {
        overlay(&mut result, block, x, ascent - block.baseline);
        x += block.width;
    }
    result
}

fn text_box(text: &str, style: &Style) -> Block {
    let graphemes: Vec<&str> = text.graphemes(true).collect();
    let width = graphemes.iter().map(|grapheme| cell_width(grapheme)).sum();
    let mut result = blank(width, 1, 0);
    let mut x = 0;
    for grapheme in graphemes {
        set_cell(&mut result, x, 0, grapheme, style);
        x += cell_width(grapheme);
    }
    result
}

fn blank(width: i32, height: i32, baseline: i32) -> Block {
    let (width, height) = (width.max(0), height.max(1));
    Block {
        width,
        height,
        baseline: baseline.max(0),
        cells: vec![vec![None; width as usize]; height as usize],
    }
}

fn overlay(target: &mut Block, source: &Block, x: i32, y: i32) {
    for (source_y, row) in source.cells.iter().enumerate() {
        for (source_x, cell) in row.iter().enumerate() {
            let Some(cell) = cell else { continue };
            let (cx, cy) = (x + source_x as i32, y + source_y as i32);
            if cx >= 0 && cy >= 0 && cx < target.width && cy < target.height {
                target.cells[cy as usize][cx as usize] = Some(cell.clone());
            }
        }
    }
}

fn draw_horizontal(block: &mut Block, y: i32, x: i32, width: i32, text: &str, style: &Style) {
    for offset in 0..width {
        set_cell(block, x + offset, y, text, style);
    }
}

fn set_cell(block: &mut Block, x: i32, y: i32, text: &str, style: &Style) {
    if x < 0 || y < 0 || x >= block.width || y >= block.height {
        return;
    }
    block.cells[y as usize][x as usize] = Some(Cell {
        text: text.to_owned(),
        style: style.clone(),
    });
}

fn node_role(node: &Node) -> Option<Role> {
    match node {
        Node::Symbol { role, .. } => *role,
        // Tall constructs need a terminal-cell side bearing. Treating them like operators gives their fraction
        // bars and radical hooks breathing room without adding padding inside the construct itself.
        Node::Operator { .. } | Node::Fraction { .. } | Node::Root { .. } | Node::Matrix { .. } => {
            Some(Role::Operator)
        }
        Node::Scripts { base, .. } => node_role(base),
        _ => None,
    }
}

fn needs_space(previous: Option<Role>, current: Option<Role>, count: usize) -> bool {
    use Role::*;
    if count == 0
        || matches!(previous, Some(Punctuation | Opening))
        || matches!(current, Some(Punctuation | Closing))
    {
        return false;
    }
    matches!(previous, Some(Binary | Relation | Operator))
        || matches!(current, Some(Binary | Relation | Operator))
}

fn normalize_binary(
    role: Option<Role>,
    previous: Option<Role>,
    next: Option<Role>,
) -> Option<Role> {
    use Role::*;
    if role != Some(Binary) {
        return role;
    }
    let unary = matches!(
        previous,
        None | Some(Binary | Relation | Operator | Punctuation | Opening)
    ) || matches!(next, None | Some(Binary | Relation | Punctuation | Closing));
    if unary { Some(Ordinary) } else { role }
}

fn next_significant_role(nodes: &[Node]) -> Option<Role> {
    nodes
        .iter()
        .find(|node| !matches!(node, Node::Space(_)))
        .map(|node| node_role(node).unwrap_or(Role::Ordinary))
}

fn simple_text(node: &Node) -> Option<String> {
    match node {
        Node::Symbol { value, .. } | Node::Text(value) | Node::Operator { value, .. } => {
            Some(value.clone())
        }
        Node::Row(body) => body.iter().map(simple_text).collect(),
        _ => None,
    }
}

fn map_script(value: &str, table: &[(char, char)]) -> Option<String> {
    value
        .chars()
        .map(|char| {
            table
                .iter()
                .find(|(from, _)| *from == char)
                .map(|(_, to)| *to)
        })
        .collect()
}

fn with_variant(context: &Context, variant: Variant) -> Context {
    let mut context = context.clone();
    context.variant = Some(variant);
    match variant {
        Variant::Bold => context.style.bold = true,
        Variant::Italic => context.style.italic = true,
        _ => {}
    }
    context
}

fn apply_variant(value: &str, variant: Option<Variant>) -> String {
    // The first capital, first small letter, and first digit of each alphabet's Unicode block.
    let (capital, small, digit, exceptions): (u32, u32, Option<u32>, &[(char, char)]) =
        match variant {
            Some(Variant::DoubleStruck) => (0x1d538, 0x1d552, Some(0x1d7d8), DOUBLE_STRUCK),
            Some(Variant::Script) => (0x1d49c, 0x1d4b6, None, SCRIPT),
            Some(Variant::Fraktur) => (0x1d504, 0x1d51e, None, FRAKTUR),
            Some(Variant::Sans) => (0x1d5a0, 0x1d5ba, Some(0x1d7e2), &[]),
            Some(Variant::Monospace) => (0x1d670, 0x1d68a, Some(0x1d7f6), &[]),
            _ => return value.to_owned(),
        };
    value
        .chars()
        .map(|char| {
            if let Some((_, exception)) = exceptions.iter().find(|(from, _)| *from == char) {
                return *exception;
            }
            let code = char as u32;
            let mapped = match char {
                'A'..='Z' => Some(capital + code - 'A' as u32),
                'a'..='z' => Some(small + code - 'a' as u32),
                '0'..='9' => digit.map(|digit| digit + code - '0' as u32),
                _ => None,
            };
            mapped.and_then(char::from_u32).unwrap_or(char)
        })
        .collect()
}

/// The cells a grapheme takes, as TS `cellWidth` computes it.
pub fn cell_width(value: &str) -> i32 {
    let mut chars = value.chars();
    let Some(first) = chars.next() else {
        return 0;
    };
    let single = chars.next().is_none();
    let zero = matches!(first, '\u{0}'..='\u{1f}' | '\u{7f}'..='\u{9f}' | '\u{300}'..='\u{36f}' | '\u{fe00}'..='\u{fe0f}');
    if single && zero {
        return 0;
    }
    let code = first as u32;
    let wide = code >= 0x1100
        && (code <= 0x115f
            || code == 0x2329
            || code == 0x232a
            || (0x2e80..=0xa4cf).contains(&code)
            || (0xac00..=0xd7a3).contains(&code)
            || (0xf900..=0xfaff).contains(&code)
            || (0xfe10..=0xfe6f).contains(&code)
            || (0xff00..=0xff60).contains(&code)
            || (0xffe0..=0xffe6).contains(&code)
            || (0x1f300..=0x1faff).contains(&code));
    if wide { 2 } else { 1 }
}

const SUPERSCRIPTS: &[(char, char)] = &[
    ('0', '⁰'),
    ('1', '¹'),
    ('2', '²'),
    ('3', '³'),
    ('4', '⁴'),
    ('5', '⁵'),
    ('6', '⁶'),
    ('7', '⁷'),
    ('8', '⁸'),
    ('9', '⁹'),
    ('+', '⁺'),
    ('-', '⁻'),
    ('=', '⁼'),
    ('(', '⁽'),
    (')', '⁾'),
    ('n', 'ⁿ'),
    ('i', 'ⁱ'),
];

const SUBSCRIPTS: &[(char, char)] = &[
    ('0', '₀'),
    ('1', '₁'),
    ('2', '₂'),
    ('3', '₃'),
    ('4', '₄'),
    ('5', '₅'),
    ('6', '₆'),
    ('7', '₇'),
    ('8', '₈'),
    ('9', '₉'),
    ('+', '₊'),
    ('-', '₋'),
    ('=', '₌'),
    ('(', '₍'),
    (')', '₎'),
    ('a', 'ₐ'),
    ('e', 'ₑ'),
    ('h', 'ₕ'),
    ('i', 'ᵢ'),
    ('j', 'ⱼ'),
    ('k', 'ₖ'),
    ('l', 'ₗ'),
    ('m', 'ₘ'),
    ('n', 'ₙ'),
    ('o', 'ₒ'),
    ('p', 'ₚ'),
    ('r', 'ᵣ'),
    ('s', 'ₛ'),
    ('t', 'ₜ'),
    ('u', 'ᵤ'),
    ('v', 'ᵥ'),
    ('x', 'ₓ'),
];

const DOUBLE_STRUCK: &[(char, char)] = &[
    ('C', 'ℂ'),
    ('H', 'ℍ'),
    ('N', 'ℕ'),
    ('P', 'ℙ'),
    ('Q', 'ℚ'),
    ('R', 'ℝ'),
    ('Z', 'ℤ'),
];

const SCRIPT: &[(char, char)] = &[
    ('B', 'ℬ'),
    ('E', 'ℰ'),
    ('F', 'ℱ'),
    ('H', 'ℋ'),
    ('I', 'ℐ'),
    ('L', 'ℒ'),
    ('M', 'ℳ'),
    ('R', 'ℛ'),
    ('e', 'ℯ'),
    ('g', 'ℊ'),
    ('o', 'ℴ'),
];

const FRAKTUR: &[(char, char)] = &[('C', 'ℭ'), ('H', 'ℌ'), ('I', 'ℑ'), ('R', 'ℜ'), ('Z', 'ℨ')];
