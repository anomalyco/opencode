use super::*;
use std::panic::{AssertUnwindSafe, catch_unwind};

fn terminal() -> Terminal {
    Terminal::new(TerminalOptions {
        cols: 20,
        rows: 5,
        max_scrollback: 1024,
    })
    .unwrap()
}

#[test]
fn callbacks_survive_moves_and_return_owned_data() {
    let mut terminals = vec![terminal()];
    let mut terminal = terminals.pop().unwrap();
    terminal.vt_write(b"\x1b[5n\x1b]2;first\x07");
    assert_eq!(
        terminal.take_writes(),
        VecDeque::from([b"\x1b[0n".to_vec()])
    );
    let title = terminal.take_title().unwrap();
    terminal.vt_write(b"\x1b[5n\x1b]2;second\x07");
    assert_eq!(title, "first");
    assert_eq!(terminal.take_title().as_deref(), Some("second"));
    assert_eq!(
        terminal.take_writes(),
        VecDeque::from([b"\x1b[0n".to_vec()])
    );
    assert!(terminal.take_title().is_none());
    assert!(terminal.take_writes().is_empty());
}

#[test]
fn empty_native_values_and_small_buffers_are_safe() {
    assert!(
        Terminal::new(TerminalOptions {
            cols: 0,
            rows: 1,
            max_scrollback: 0
        })
        .is_err()
    );
    let mut terminal = terminal();
    assert_eq!(terminal.title().unwrap(), "");
    assert!(terminal.format(Format::Plain).unwrap().is_empty());
    assert_eq!(terminal.format_row(0, &mut []).unwrap(), 0);
    assert_eq!(terminal.selection_text(&mut []).unwrap(), None);
    terminal.vt_write("a\u{301}界".as_bytes());
    assert!(terminal.format_row(0, &mut [0; 1]).is_err());
    let mut buffer = [0; 32];
    let len = terminal.format_row(0, &mut buffer).unwrap();
    assert_eq!(&buffer[..len], "a\u{301}界".as_bytes());
    assert!(terminal.format_row(1000, &mut buffer).is_err());
    assert!(terminal.resize(0, 5).is_err());
}

#[test]
fn formatted_bytes_outlive_the_native_terminal() {
    let bytes = {
        let mut terminal = terminal();
        terminal.vt_write("hello 界".as_bytes());
        terminal.format(Format::Plain).unwrap()
    };
    assert_eq!(bytes, "hello 界".as_bytes());
}

#[test]
fn callback_panics_are_resumed_outside_the_c_boundary() {
    let mut terminal = terminal();
    for resize in [false, true] {
        // Deliberately provoke an assertion panic inside the callback. It must return
        // normally to C; either mutating wrapper resumes the panic later in Rust.
        unsafe {
            Effects::write_pty(
                terminal.raw.as_ptr(),
                terminal.effects.userdata().cast_mut(),
                ptr::null(),
                1,
            )
        };
        assert!(
            catch_unwind(AssertUnwindSafe(|| {
                if resize {
                    terminal.resize(30, 10).unwrap();
                } else {
                    terminal.vt_write(b"");
                }
            }))
            .is_err()
        );
    }
    terminal.vt_write(b"\x1b[5n");
    assert_eq!(
        terminal.take_writes(),
        VecDeque::from([b"\x1b[0n".to_vec()])
    );
}
