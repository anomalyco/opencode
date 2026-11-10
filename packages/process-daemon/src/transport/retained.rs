use std::ptr::NonNull;

/// Own a value whose raw pointer is retained by native I/O. Moving this owner or
/// retrieving its pointer must not reborrow the value while native code accesses
/// it. The caller must reap native I/O before dropping this allocation.
pub(crate) struct Retained<T>(NonNull<T>);

impl<T> Retained<T> {
    pub fn new(value: T) -> Self {
        Self(NonNull::new(Box::into_raw(Box::new(value))).expect("Box pointer is non-null"))
    }

    pub fn as_ptr(&self) -> *mut T {
        self.0.as_ptr()
    }
}

impl<T> Drop for Retained<T> {
    fn drop(&mut self) {
        // SAFETY: this owner uniquely owns the Box allocation. All native access
        // must have finished before the caller permits this owner to drop.
        unsafe {
            drop(Box::from_raw(self.0.as_ptr()));
        }
    }
}
