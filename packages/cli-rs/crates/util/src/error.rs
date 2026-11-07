//! A boxed error with a context chain, in place of `anyhow`: `{}` prints the outermost message, `{:#}` the whole chain
//! joined by `: `, and `downcast_ref` finds the error under any context. No backtraces.

use std::error::Error as StdError;
use std::fmt::{self, Debug, Display};

pub struct Error(Box<dyn StdError + Send + Sync + 'static>);

pub type Result<T, E = Error> = std::result::Result<T, E>;

/// `return Err(err!(...))`.
#[macro_export]
macro_rules! bail {
    ($($arg:tt)*) => {
        return ::std::result::Result::Err($crate::err!($($arg)*))
    };
}

/// An [`Error`] from a format string, or from one value that implements `Display`.
#[macro_export]
macro_rules! err {
    ($message:literal $(,)?) => {
        $crate::error::Error::msg(::std::format!($message))
    };
    ($message:expr $(,)?) => {
        $crate::error::Error::msg($message)
    };
    ($format:expr, $($arg:tt)+) => {
        $crate::error::Error::msg(::std::format!($format, $($arg)+))
    };
}

impl Error {
    pub fn new<E: StdError + Send + Sync + 'static>(error: E) -> Self {
        Self(Box::new(error))
    }

    pub fn msg<M: Display + Debug + Send + Sync + 'static>(message: M) -> Self {
        Self(Box::new(Message(message)))
    }

    pub fn context<C: Display + Send + Sync + 'static>(self, context: C) -> Self {
        Self(Box::new(Contextual { context: Box::new(context), source: self.0 }))
    }

    /// This error, then each source in turn.
    pub fn chain(&self) -> impl Iterator<Item = &(dyn StdError + 'static)> {
        std::iter::successors(Some(&*self.0 as &(dyn StdError + 'static)), |&error| error.source())
    }

    /// The error under the contexts, or a context, as a `T`.
    pub fn downcast_ref<T: StdError + 'static>(&self) -> Option<&T> {
        let mut error = &*self.0;
        loop {
            if let Some(found) = error.downcast_ref::<T>() {
                return Some(found);
            }
            error = &*error.downcast_ref::<Contextual>()?.source;
        }
    }

    pub fn is<T: StdError + 'static>(&self) -> bool {
        self.downcast_ref::<T>().is_some()
    }
}

impl<E: StdError + Send + Sync + 'static> From<E> for Error {
    fn from(error: E) -> Self {
        Self::new(error)
    }
}

impl Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)?;
        if f.alternate() {
            for cause in self.chain().skip(1) {
                write!(f, ": {cause}")?;
            }
        }
        Ok(())
    }
}

impl Debug for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)?;
        let causes: Vec<_> = self.chain().skip(1).collect();
        if causes.is_empty() {
            return Ok(());
        }
        write!(f, "\n\nCaused by:")?;
        if let [cause] = causes[..] {
            return write!(f, "\n    {cause}");
        }
        causes.iter().enumerate().try_for_each(|(index, cause)| write!(f, "\n    {index}: {cause}"))
    }
}

pub trait Context<T> {
    fn context<C: Display + Send + Sync + 'static>(self, context: C) -> Result<T>;

    fn with_context<C: Display + Send + Sync + 'static, F: FnOnce() -> C>(self, context: F) -> Result<T>;
}

impl<T, E: Into<Error>> Context<T> for Result<T, E> {
    fn context<C: Display + Send + Sync + 'static>(self, context: C) -> Result<T> {
        self.map_err(|error| error.into().context(context))
    }

    fn with_context<C: Display + Send + Sync + 'static, F: FnOnce() -> C>(self, context: F) -> Result<T> {
        self.map_err(|error| error.into().context(context()))
    }
}

impl<T> Context<T> for Option<T> {
    fn context<C: Display + Send + Sync + 'static>(self, context: C) -> Result<T> {
        self.ok_or_else(|| Error(Box::new(Message(context))))
    }

    fn with_context<C: Display + Send + Sync + 'static, F: FnOnce() -> C>(self, context: F) -> Result<T> {
        self.ok_or_else(|| Error(Box::new(Message(context()))))
    }
}

struct Message<M>(M);

impl<M: Display> Display for Message<M> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        Display::fmt(&self.0, f)
    }
}

impl<M: Display> Debug for Message<M> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        Display::fmt(&self.0, f)
    }
}

impl<M: Display> StdError for Message<M> {}

struct Contextual {
    context: Box<dyn Display + Send + Sync>,
    source: Box<dyn StdError + Send + Sync + 'static>,
}

impl Display for Contextual {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.context.fmt(f)
    }
}

impl Debug for Contextual {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.context.fmt(f)
    }
}

impl StdError for Contextual {
    fn source(&self) -> Option<&(dyn StdError + 'static)> {
        Some(&*self.source)
    }
}

#[cfg(test)]
mod tests {
    use super::{Context, Error, Result};
    use std::fmt;

    #[derive(Debug)]
    struct Leaf;

    impl fmt::Display for Leaf {
        fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
            f.write_str("leaf failed")
        }
    }

    impl std::error::Error for Leaf {}

    #[derive(Debug)]
    struct Outer(Leaf);

    impl fmt::Display for Outer {
        fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
            f.write_str("outer failed")
        }
    }

    impl std::error::Error for Outer {
        fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
            Some(&self.0)
        }
    }

    #[derive(Debug)]
    struct Unrelated;

    impl fmt::Display for Unrelated {
        fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
            f.write_str("unrelated")
        }
    }

    impl std::error::Error for Unrelated {}

    fn failing() -> Result<()> {
        Err(Outer(Leaf))?
    }

    fn render(error: &Error) -> [String; 3] {
        [format!("{error}"), format!("{error:#}"), format!("{error:?}")]
    }

    #[test]
    fn formats_like_anyhow() {
        let x = 7;
        let cases: [(Error, [&str; 3]); 8] = [
            (crate::err!("plain"), ["plain", "plain", "plain"]),
            (crate::err!("value {x}"), ["value 7", "value 7", "value 7"]),
            (crate::err!("{} and {}", 1, 2), ["1 and 2", "1 and 2", "1 and 2"]),
            (crate::err!(String::from("owned")), ["owned", "owned", "owned"]),
            (Error::new(Leaf), ["leaf failed", "leaf failed", "leaf failed"]),
            (
                Error::new(Outer(Leaf)),
                ["outer failed", "outer failed: leaf failed", "outer failed\n\nCaused by:\n    leaf failed"],
            ),
            (
                failing().context("reading").unwrap_err(),
                [
                    "reading",
                    "reading: outer failed: leaf failed",
                    "reading\n\nCaused by:\n    0: outer failed\n    1: leaf failed",
                ],
            ),
            (
                Err::<(), _>(Leaf).context("inner").with_context(|| format!("outer {x}")).unwrap_err(),
                ["outer 7", "outer 7: inner: leaf failed", "outer 7\n\nCaused by:\n    0: inner\n    1: leaf failed"],
            ),
        ];
        for (error, expected) in cases {
            assert_eq!(render(&error), expected.map(String::from));
        }
    }

    #[test]
    fn option_context() {
        let error = None::<()>.context("missing").unwrap_err();
        assert_eq!(render(&error), ["missing", "missing", "missing"].map(String::from));
        assert_eq!(Some(3).context("missing").unwrap(), 3);
        assert_eq!(None::<()>.with_context(|| "lazy").unwrap_err().to_string(), "lazy");
    }

    #[test]
    fn bail_returns_early() {
        fn check(fail: bool) -> Result<u8> {
            if fail {
                crate::bail!("failed with {}", 2);
            }
            Ok(1)
        }
        assert_eq!(check(false).unwrap(), 1);
        assert_eq!(check(true).unwrap_err().to_string(), "failed with 2");
    }

    #[test]
    fn downcasts_under_contexts() {
        let error = Error::new(Outer(Leaf)).context("one").context("two");
        assert!(error.downcast_ref::<Outer>().is_some());
        assert!(error.is::<Outer>());
        // As in anyhow, a source of the wrapped error is not the error itself.
        assert!(error.downcast_ref::<Leaf>().is_none());
        assert!(error.downcast_ref::<Unrelated>().is_none());
        assert!(crate::err!("message").downcast_ref::<Leaf>().is_none());
    }
}
