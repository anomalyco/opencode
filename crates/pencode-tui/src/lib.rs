//! Terminal UI for pencode: a scrollable transcript with an input line.
//!
//! Keys: type a prompt and press Enter to append it to the session,
//! Esc or Ctrl+C quits.

use anyhow::Context;
use pencode_core::App;
use pencode_protocol::{Message, Part, Role};
use ratatui::backend::CrosstermBackend;
use ratatui::layout::{Constraint, Layout};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, List, ListItem, Paragraph};
use ratatui::{Frame, Terminal};
use std::io::{Stdout, Write};

pub fn run(app: App) -> anyhow::Result<()> {
    let store = app.store().clone();
    let mut session = store.create(".")?;

    crossterm::terminal::enable_raw_mode()?;
    let mut stdout = std::io::stdout();
    crossterm::execute!(stdout, crossterm::terminal::EnterAlternateScreen)?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;

    let result = event_loop(&mut terminal, &mut session);

    crossterm::terminal::disable_raw_mode()?;
    crossterm::execute!(
        std::io::stdout(),
        crossterm::terminal::LeaveAlternateScreen
    )?;
    result
}

fn event_loop(
    terminal: &mut Terminal<CrosstermBackend<Stdout>>,
    session: &mut pencode_protocol::Session,
) -> anyhow::Result<()> {
    let mut input = String::new();
    loop {
        terminal.draw(|frame| draw(frame, session, &input))?;

        if !crossterm::event::poll(std::time::Duration::from_millis(100))? {
            continue;
        }
        if let crossterm::event::Event::Key(key) = crossterm::event::read()? { match key.code {
            crossterm::event::KeyCode::Esc => break,
            crossterm::event::KeyCode::Char('c')
                if key.modifiers.contains(crossterm::event::KeyModifiers::CONTROL) =>
            {
                break
            }
            crossterm::event::KeyCode::Backspace => {
                input.pop();
            }
            crossterm::event::KeyCode::Enter => {
                if !input.trim().is_empty() {
                    let text = std::mem::take(&mut input);
                    let message = Message::new(Role::User, vec![Part::text(text)]);
                    session.push(message);
                    // TODO: route through the model provider once wired up;
                    // the assistant reply currently arrives via the server API.
                }
            }
            crossterm::event::KeyCode::Char(ch) => input.push(ch),
            _ => {}
        } }
    }
    Ok(())
}

fn draw(frame: &mut Frame, session: &pencode_protocol::Session, input: &str) {
    let [transcript_area, input_area] =
        Layout::vertical([Constraint::Min(3), Constraint::Length(3)]).areas(frame.area());

    let items: Vec<ListItem> = session
        .messages
        .iter()
        .flat_map(|message| {
            let (label, color) = match message.role {
                Role::User => ("you", Color::Blue),
                Role::Assistant => ("pencode", Color::Green),
            };
            message
                .parts
                .iter()
                .filter_map(Part::as_text)
                .flat_map(move |text| {
                    text.lines()
                        .map(move |line| Line::from(vec![
                            Span::styled(
                                format!("{label}> "),
                                Style::default().fg(color).add_modifier(Modifier::BOLD),
                            ),
                            Span::raw(line),
                        ]))
                        .map(ListItem::new)
                })
        })
        .collect();

    let transcript = List::new(items).block(Block::default().borders(Borders::ALL).title(format!(
        " pencode — {} ",
        session.title
    )));
    frame.render_widget(transcript, transcript_area);

    let prompt = Paragraph::new(input).block(Block::default().borders(Borders::ALL).title(" prompt "));
    frame.render_widget(prompt, input_area);
}

/// Kept for future non-TUI fallback rendering.
#[allow(dead_code)]
fn flush_stdout(stdout: &mut Stdout) -> anyhow::Result<()> {
    stdout.flush().context("flushing stdout")
}
