//! The service's small, actor-local adapter to the official libghostty C API.
//! Native handles and borrowed grid references never leave this module.

mod effects;
mod ffi;

use std::collections::VecDeque;
use std::ffi::c_void;
use std::marker::PhantomData;
use std::mem::MaybeUninit;
use std::ptr::{self, NonNull};
use std::rc::Rc;

use anyhow::{Context, Result, bail, ensure};

use effects::Effects;

#[derive(Clone, Copy)]
pub(crate) struct TerminalOptions {
    pub cols: u16,
    pub rows: u16,
    pub max_scrollback: usize,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Format {
    Plain,
    Vt,
}

pub(crate) struct Terminal {
    raw: NonNull<ffi::GhosttyTerminalImpl>,
    // Shared callback state stays alive until after ghostty_terminal_free.
    effects: Effects,
    // Creation, access, callbacks, and destruction all belong to one actor thread.
    _actor: PhantomData<Rc<()>>,
}

impl Terminal {
    pub fn new(options: TerminalOptions) -> Result<Self> {
        ensure!(
            options.cols > 0 && options.rows > 0,
            "terminal dimensions must be positive"
        );
        let mut raw = ptr::null_mut();
        // SAFETY: options match the pinned C header; NULL selects Ghostty's allocator.
        check(unsafe {
            ffi::ghostty_terminal_new(
                ptr::null(),
                &mut raw,
                ffi::GhosttyTerminalOptions {
                    cols: options.cols,
                    rows: options.rows,
                    max_scrollback: options.max_scrollback,
                },
            )
        })?;
        let terminal = Self {
            raw: NonNull::new(raw).context("Ghostty returned a null terminal")?,
            effects: Effects::default(),
            _actor: PhantomData,
        };

        // SAFETY: userdata is an Rc-derived shared pointer retained until after terminal_free.
        // These callbacks only copy responses/mark a title change; they never reenter Ghostty.
        unsafe {
            check(ffi::ghostty_terminal_set(
                raw,
                ffi::GHOSTTY_TERMINAL_OPT_USERDATA,
                terminal.effects.userdata(),
            ))?;
            check(ffi::ghostty_terminal_set(
                raw,
                ffi::GHOSTTY_TERMINAL_OPT_WRITE_PTY,
                Effects::write_pty as *const c_void,
            ))?;
            check(ffi::ghostty_terminal_set(
                raw,
                ffi::GHOSTTY_TERMINAL_OPT_TITLE_CHANGED,
                Effects::title_changed as *const c_void,
            ))?;
        }
        Ok(terminal)
    }

    pub fn vt_write(&mut self, bytes: &[u8]) {
        // SAFETY: the byte slice lives through this synchronous call, and &mut self
        // excludes other native operations. No callback can access this Rust wrapper.
        unsafe { ffi::ghostty_terminal_vt_write(self.raw.as_ptr(), bytes.as_ptr(), bytes.len()) };
        self.effects.resume_panic();
    }

    pub fn take_writes(&mut self) -> VecDeque<Vec<u8>> {
        self.effects.take_writes()
    }

    pub fn take_title(&mut self) -> Option<String> {
        if !self.effects.take_title_changed() {
            return None;
        }
        self.title().ok()
    }

    fn title(&self) -> Result<String> {
        // SAFETY: TITLE writes a GhosttyString. Copy its borrowed data before mutation.
        let value: ffi::GhosttyString = unsafe { self.get(ffi::GHOSTTY_TERMINAL_DATA_TITLE)? };
        if value.len == 0 {
            return Ok(String::new());
        }
        ensure!(!value.ptr.is_null(), "Ghostty returned a null title");
        ensure!(
            value.len <= isize::MAX as usize,
            "Ghostty title is too large"
        );
        // SAFETY: Ghostty owns these bytes until the next mutating call, excluded by &self.
        Ok(
            std::str::from_utf8(unsafe { std::slice::from_raw_parts(value.ptr, value.len) })?
                .to_owned(),
        )
    }

    pub fn resize(&mut self, cols: u16, rows: u16) -> Result<()> {
        ensure!(cols > 0 && rows > 0, "terminal dimensions must be positive");
        // SAFETY: a live actor-local handle with valid dimensions and no borrowed grid refs.
        let result = unsafe { ffi::ghostty_terminal_resize(self.raw.as_ptr(), cols, rows, 0, 0) };
        // Resize can emit in-band size reports through the same PTY callback.
        self.effects.resume_panic();
        check(result)
    }

    pub fn cols(&self) -> Result<u16> {
        // SAFETY: COLS writes uint16_t.
        unsafe { self.get(ffi::GHOSTTY_TERMINAL_DATA_COLS) }
    }

    pub fn rows(&self) -> Result<u16> {
        // SAFETY: ROWS writes uint16_t.
        unsafe { self.get(ffi::GHOSTTY_TERMINAL_DATA_ROWS) }
    }

    pub fn cursor_x(&self) -> Result<u16> {
        // SAFETY: CURSOR_X writes uint16_t.
        unsafe { self.get(ffi::GHOSTTY_TERMINAL_DATA_CURSOR_X) }
    }

    pub fn cursor_y(&self) -> Result<u16> {
        // SAFETY: CURSOR_Y writes uint16_t.
        unsafe { self.get(ffi::GHOSTTY_TERMINAL_DATA_CURSOR_Y) }
    }

    pub fn total_rows(&self) -> Result<usize> {
        // SAFETY: TOTAL_ROWS writes size_t.
        unsafe { self.get(ffi::GHOSTTY_TERMINAL_DATA_TOTAL_ROWS) }
    }

    /// Caller must match T to the selected C output type. Never exposed outside this module.
    unsafe fn get<T>(&self, data: ffi::GhosttyTerminalData) -> Result<T> {
        let mut value = MaybeUninit::<T>::uninit();
        // SAFETY: guaranteed by the typed getter calling this function.
        check(unsafe {
            ffi::ghostty_terminal_get(self.raw.as_ptr(), data, value.as_mut_ptr().cast())
        })?;
        // SAFETY: a successful get initialized the selected output type.
        Ok(unsafe { value.assume_init() })
    }

    pub fn format(&self, format: Format) -> Result<Vec<u8>> {
        let formatter = Formatter::new(self, format, None)?;
        let mut ptr = ptr::null_mut();
        let mut len = 0;
        // SAFETY: formatter is live, out pointers are valid, allocator matches Allocation::drop.
        check(unsafe {
            ffi::ghostty_formatter_format_alloc(
                formatter.raw.as_ptr(),
                ptr::null(),
                &mut ptr,
                &mut len,
            )
        })?;
        ensure!(
            len == 0 || !ptr.is_null(),
            "Ghostty returned a null formatted buffer"
        );
        ensure!(
            len <= isize::MAX as usize,
            "Ghostty formatted buffer is too large"
        );
        let bytes = Allocation { ptr, len };
        if bytes.len == 0 {
            return Ok(Vec::new());
        }
        // SAFETY: Ghostty allocated len bytes; copy before the allocation guard frees them.
        Ok(unsafe { std::slice::from_raw_parts(bytes.ptr, bytes.len) }.to_vec())
    }

    pub fn format_row(&self, y: u32, buffer: &mut [u8]) -> Result<usize> {
        let selection = self.selection((0, y), (self.cols()? - 1, y))?;
        let formatter = Formatter::new(self, Format::Plain, Some(&selection))?;
        let mut written = 0;
        // SAFETY: terminal and selection outlive formatter; the buffer is valid for its length.
        check(unsafe {
            ffi::ghostty_formatter_format_buf(
                formatter.raw.as_ptr(),
                buffer.as_mut_ptr(),
                buffer.len(),
                &mut written,
            )
        })?;
        ensure!(
            written <= buffer.len(),
            "Ghostty wrote beyond the row buffer"
        );
        Ok(written)
    }

    fn grid_ref(&self, tag: ffi::GhosttyPointTag, x: u16, y: u32) -> Result<ffi::GhosttyGridRef> {
        let mut value = ffi::GhosttyGridRef {
            size: size_of::<ffi::GhosttyGridRef>(),
            ..Default::default()
        };
        // SAFETY: all tagged unions and sized structs match the pinned header. References
        // remain private and are used only while &self excludes terminal mutations.
        check(unsafe {
            ffi::ghostty_terminal_grid_ref(
                self.raw.as_ptr(),
                ffi::GhosttyPoint {
                    tag,
                    value: ffi::GhosttyPointValue {
                        coordinate: ffi::GhosttyPointCoordinate { x, y },
                    },
                },
                &mut value,
            )
        })?;
        Ok(value)
    }

    fn selection(&self, start: (u16, u32), end: (u16, u32)) -> Result<ffi::GhosttySelection> {
        Ok(ffi::GhosttySelection {
            size: size_of::<ffi::GhosttySelection>(),
            start: self.grid_ref(ffi::GHOSTTY_POINT_TAG_SCREEN, start.0, start.1)?,
            end: self.grid_ref(ffi::GHOSTTY_POINT_TAG_SCREEN, end.0, end.1)?,
            rectangle: false,
        })
    }

    #[cfg(test)]
    pub fn scroll_to_top(&mut self) {
        // SAFETY: TOP ignores the zeroed value union.
        unsafe {
            ffi::ghostty_terminal_scroll_viewport(
                self.raw.as_ptr(),
                ffi::GhosttyTerminalScrollViewport {
                    tag: ffi::GHOSTTY_SCROLL_VIEWPORT_TOP,
                    value: Default::default(),
                },
            )
        };
    }

    #[cfg(test)]
    pub fn viewport_row(&self) -> Result<u32> {
        let origin = self.grid_ref(ffi::GHOSTTY_POINT_TAG_VIEWPORT, 0, 0)?;
        let mut point = ffi::GhosttyPointCoordinate::default();
        // SAFETY: origin was just read from this terminal, which has not been mutated.
        check(unsafe {
            ffi::ghostty_terminal_point_from_grid_ref(
                self.raw.as_ptr(),
                &origin,
                ffi::GHOSTTY_POINT_TAG_SCREEN,
                &mut point,
            )
        })?;
        Ok(point.y)
    }

    #[cfg(test)]
    pub fn set_selection(&mut self, start: (u16, u32), end: (u16, u32)) -> Result<()> {
        let selection = self.selection(start, end)?;
        // SAFETY: set copies the selection into terminal-owned state during the call.
        check(unsafe {
            ffi::ghostty_terminal_set(
                self.raw.as_ptr(),
                ffi::GHOSTTY_TERMINAL_OPT_SELECTION,
                ptr::from_ref(&selection).cast(),
            )
        })
    }

    #[cfg(test)]
    pub fn selection_text(&self, buffer: &mut [u8]) -> Result<Option<usize>> {
        let mut written = 0;
        // SAFETY: NULL selection reads the terminal-owned selection; out buffer is valid.
        let result = unsafe {
            ffi::ghostty_terminal_selection_format_buf(
                self.raw.as_ptr(),
                ffi::GhosttyTerminalSelectionFormatOptions {
                    size: size_of::<ffi::GhosttyTerminalSelectionFormatOptions>(),
                    emit: ffi::GHOSTTY_FORMATTER_FORMAT_PLAIN,
                    unwrap: true,
                    trim: true,
                    selection: ptr::null(),
                },
                buffer.as_mut_ptr(),
                buffer.len(),
                &mut written,
            )
        };
        if result == ffi::GHOSTTY_NO_VALUE {
            return Ok(None);
        }
        check(result)?;
        ensure!(
            written <= buffer.len(),
            "Ghostty wrote beyond the selection buffer"
        );
        Ok(Some(written))
    }
}

impl Drop for Terminal {
    fn drop(&mut self) {
        // SAFETY: this is the sole owner, and effects remain alive until this call finishes.
        unsafe { ffi::ghostty_terminal_free(self.raw.as_ptr()) };
    }
}

struct Formatter<'a> {
    raw: NonNull<ffi::GhosttyFormatterImpl>,
    _borrow: PhantomData<(&'a Terminal, &'a ffi::GhosttySelection)>,
}

impl<'a> Formatter<'a> {
    fn new(
        terminal: &'a Terminal,
        format: Format,
        selection: Option<&'a ffi::GhosttySelection>,
    ) -> Result<Self> {
        let extras = selection.is_none();
        let options = ffi::GhosttyFormatterTerminalOptions {
            size: size_of::<ffi::GhosttyFormatterTerminalOptions>(),
            emit: match format {
                Format::Plain => ffi::GHOSTTY_FORMATTER_FORMAT_PLAIN,
                Format::Vt => ffi::GHOSTTY_FORMATTER_FORMAT_VT,
            },
            unwrap: false,
            trim: true,
            extra: ffi::GhosttyFormatterTerminalExtra {
                size: size_of::<ffi::GhosttyFormatterTerminalExtra>(),
                palette: false,
                modes: extras,
                scrolling_region: extras,
                tabstops: extras,
                pwd: extras,
                keyboard: extras,
                screen: ffi::GhosttyFormatterScreenExtra {
                    size: size_of::<ffi::GhosttyFormatterScreenExtra>(),
                    cursor: false,
                    style: extras,
                    hyperlink: extras,
                    protection: extras,
                    kitty_keyboard: extras,
                    charsets: extras,
                },
            },
            selection: selection.map_or(ptr::null(), ptr::from_ref),
        };
        let mut raw = ptr::null_mut();
        // SAFETY: sized fields are initialized, and both borrowed values outlive the formatter.
        check(unsafe {
            ffi::ghostty_formatter_terminal_new(
                ptr::null(),
                &mut raw,
                terminal.raw.as_ptr(),
                options,
            )
        })?;
        Ok(Self {
            raw: NonNull::new(raw).context("Ghostty returned a null formatter")?,
            _borrow: PhantomData,
        })
    }
}

impl Drop for Formatter<'_> {
    fn drop(&mut self) {
        // SAFETY: this is the sole owner; the terminal and selection are still borrowed.
        unsafe { ffi::ghostty_formatter_free(self.raw.as_ptr()) };
    }
}

struct Allocation {
    ptr: *mut u8,
    len: usize,
}

impl Drop for Allocation {
    fn drop(&mut self) {
        // SAFETY: allocated by Ghostty's default allocator, not Rust's allocator.
        unsafe { ffi::ghostty_free(ptr::null(), self.ptr, self.len) };
    }
}

fn check(result: ffi::GhosttyResult) -> Result<()> {
    match result {
        ffi::GHOSTTY_SUCCESS => Ok(()),
        ffi::GHOSTTY_OUT_OF_MEMORY => bail!("Ghostty allocation failed"),
        ffi::GHOSTTY_INVALID_VALUE => bail!("Ghostty rejected an invalid value"),
        ffi::GHOSTTY_OUT_OF_SPACE => bail!("Ghostty output buffer is too small"),
        ffi::GHOSTTY_NO_VALUE => bail!("Ghostty value is unavailable"),
        code => bail!("Ghostty failed with result {code}"),
    }
}

#[cfg(test)]
mod tests;
