//! Per-username rate limiting for authentication attempts.
//!
//! Uses the governor crate to track failed authentication attempts per username.
//! Rate limiting checks happen BEFORE PAM auth to fail fast on brute force attacks.
//! State is in-memory and lost on restart (per design decision in CONTEXT.md).

use governor::{
    Quota, RateLimiter as GovRateLimiter,
    clock::{Clock, DefaultClock},
    state::{InMemoryState, NotKeyed},
};
use std::collections::HashMap;
use std::num::NonZeroU32;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use thiserror::Error;

/// Errors that can occur during rate limiting checks.
#[derive(Debug, Error)]
pub enum RateLimitError {
    /// Too many authentication attempts for this username.
    #[error("too many authentication attempts, retry after {retry_after:?}")]
    TooManyAttempts {
        /// Duration until the rate limit resets.
        retry_after: Duration,
    },
}

/// Per-username rate limiter for authentication attempts.
///
/// Each username has its own rate limit quota. This prevents brute-force
/// attacks targeting specific accounts.
pub struct RateLimiter {
    /// Rate limiters keyed by username.
    limiters: Mutex<HashMap<String, UserRateLimiter>>,
    /// Maximum attempts per minute.
    attempts_per_minute: u32,
}

/// State for a single user's rate limit.
struct UserRateLimiter {
    /// The actual governor rate limiter.
    limiter: GovRateLimiter<NotKeyed, InMemoryState, DefaultClock>,
    /// Last time this limiter was accessed (for cleanup).
    last_access: Instant,
}

impl RateLimiter {
    /// Create a new rate limiter with the specified attempts per minute.
    ///
    /// # Arguments
    ///
    /// * `attempts_per_minute` - Maximum failed authentication attempts allowed
    ///   per minute per username.
    ///
    /// # Panics
    ///
    /// Panics if `attempts_per_minute` is 0.
    pub fn new(attempts_per_minute: u32) -> Self {
        assert!(attempts_per_minute > 0, "attempts_per_minute must be > 0");

        Self {
            limiters: Mutex::new(HashMap::new()),
            attempts_per_minute,
        }
    }

    /// Check if a username is rate limited.
    ///
    /// This should be called BEFORE attempting PAM authentication.
    /// If rate limited, returns an error with retry_after duration.
    ///
    /// # Arguments
    ///
    /// * `username` - The username to check.
    ///
    /// # Returns
    ///
    /// * `Ok(())` - Attempt is allowed, proceed with authentication.
    /// * `Err(RateLimitError::TooManyAttempts)` - Rate limited, reject immediately.
    pub fn check(&self, username: &str) -> Result<(), RateLimitError> {
        let mut limiters = self.limiters.lock().expect("rate limiter mutex poisoned");

        // Get or create limiter for this username
        let entry = limiters.entry(username.to_string()).or_insert_with(|| {
            let quota = Quota::per_minute(
                NonZeroU32::new(self.attempts_per_minute)
                    .expect("attempts_per_minute already validated > 0"),
            );
            UserRateLimiter {
                limiter: GovRateLimiter::direct(quota),
                last_access: Instant::now(),
            }
        });

        entry.last_access = Instant::now();

        match entry.limiter.check() {
            Ok(_) => Ok(()),
            Err(not_until) => {
                let clock = DefaultClock::default();
                let retry_after = not_until.wait_time_from(clock.now());
                Err(RateLimitError::TooManyAttempts { retry_after })
            }
        }
    }

    /// Clean up stale rate limiters that haven't been accessed recently.
    ///
    /// This should be called periodically to prevent memory growth.
    /// Limiters not accessed within the given duration are removed.
    ///
    /// # Arguments
    ///
    /// * `max_age` - Maximum age of unused limiters before cleanup.
    ///
    /// # Returns
    ///
    /// Number of limiters removed.
    pub fn cleanup(&self, max_age: Duration) -> usize {
        let mut limiters = self.limiters.lock().expect("rate limiter mutex poisoned");
        let now = Instant::now();

        let before_count = limiters.len();
        limiters.retain(|_, entry| now.duration_since(entry.last_access) < max_age);
        before_count - limiters.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_allows_up_to_limit() {
        let limiter = RateLimiter::new(3);

        // Should allow up to 3 attempts
        assert!(limiter.check("alice").is_ok());
        assert!(limiter.check("alice").is_ok());
        assert!(limiter.check("alice").is_ok());
    }

    #[test]
    fn test_rejects_after_limit_exceeded() {
        let limiter = RateLimiter::new(2);

        // Allow 2 attempts
        assert!(limiter.check("bob").is_ok());
        assert!(limiter.check("bob").is_ok());

        // Third should be rejected
        let result = limiter.check("bob");
        assert!(result.is_err());

        if let Err(RateLimitError::TooManyAttempts { retry_after }) = result {
            // Should have some wait time
            assert!(retry_after > Duration::ZERO);
        } else {
            panic!("expected TooManyAttempts error");
        }
    }

    #[test]
    fn test_separate_limits_per_username() {
        let limiter = RateLimiter::new(2);

        // Alice uses her quota
        assert!(limiter.check("alice").is_ok());
        assert!(limiter.check("alice").is_ok());
        assert!(limiter.check("alice").is_err());

        // Bob should still have full quota
        assert!(limiter.check("bob").is_ok());
        assert!(limiter.check("bob").is_ok());
        assert!(limiter.check("bob").is_err());
    }

    #[test]
    fn test_cleanup_removes_stale_limiters() {
        let limiter = RateLimiter::new(5);

        // Create some limiters
        limiter.check("alice").ok();
        limiter.check("bob").ok();

        // Immediate cleanup with 0 age should remove both
        let removed = limiter.cleanup(Duration::ZERO);
        assert_eq!(removed, 2);

        // Verify they're gone (new check creates fresh limiter)
        {
            let limiters = limiter.limiters.lock().unwrap();
            assert!(limiters.is_empty());
        }
    }

    #[test]
    #[should_panic(expected = "attempts_per_minute must be > 0")]
    fn test_zero_attempts_panics() {
        RateLimiter::new(0);
    }

    #[test]
    fn test_error_message_contains_retry_after() {
        let limiter = RateLimiter::new(1);

        // Use the single attempt
        limiter.check("charlie").ok();

        // Next one should fail with informative message
        let result = limiter.check("charlie");
        let error_msg = result.unwrap_err().to_string();
        assert!(error_msg.contains("too many authentication attempts"));
        assert!(error_msg.contains("retry after"));
    }
}
