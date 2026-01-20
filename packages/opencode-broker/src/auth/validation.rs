//! Username validation following POSIX rules.
//!
//! This module provides strict username validation to prevent:
//! - Path traversal attacks
//! - Shell injection via PAM
//! - Denial of service via long usernames
//!
//! Based on systemd.io/USER_NAMES and POSIX standards.

use thiserror::Error;

/// Maximum length for usernames (practical limit for utmp compatibility).
const MAX_USERNAME_LENGTH: usize = 32;

/// Errors that can occur during username validation.
#[derive(Debug, Error, PartialEq, Eq)]
pub enum ValidationError {
    /// Username is empty.
    #[error("username cannot be empty")]
    Empty,

    /// Username exceeds maximum length.
    #[error("username exceeds maximum length of {max} characters")]
    TooLong {
        /// Maximum allowed length.
        max: usize,
    },

    /// First character is invalid.
    #[error("username must start with a lowercase letter or underscore")]
    InvalidFirstChar,

    /// Username contains an invalid character.
    #[error("username contains invalid character: {0:?}")]
    InvalidChar(char),

    /// Username is all numeric (could be confused with UID).
    #[error("username cannot be all numeric")]
    AllNumeric,
}

/// Validate a username according to POSIX rules.
///
/// # Rules
///
/// - Length: 1-32 characters
/// - First character: lowercase letter or underscore
/// - Allowed characters: lowercase letters, digits, underscore, hyphen
/// - No all-numeric usernames (confusion with UID)
/// - No uppercase letters (POSIX compliance)
/// - No spaces or special characters
///
/// # Arguments
///
/// * `username` - The username to validate.
///
/// # Returns
///
/// * `Ok(())` - Username is valid.
/// * `Err(ValidationError)` - Username is invalid with specific reason.
///
/// # Examples
///
/// ```
/// use opencode_broker::auth::validation::{validate_username, ValidationError};
///
/// assert!(validate_username("alice").is_ok());
/// assert!(validate_username("bob_smith").is_ok());
/// assert!(validate_username("user-1").is_ok());
/// assert!(validate_username("_service").is_ok());
///
/// assert_eq!(validate_username("").unwrap_err(), ValidationError::Empty);
/// assert_eq!(validate_username("Alice").unwrap_err(), ValidationError::InvalidFirstChar);
/// assert_eq!(validate_username("123").unwrap_err(), ValidationError::AllNumeric);
/// ```
pub fn validate_username(username: &str) -> Result<(), ValidationError> {
    // Length: 1-32 characters
    if username.is_empty() {
        return Err(ValidationError::Empty);
    }

    if username.len() > MAX_USERNAME_LENGTH {
        return Err(ValidationError::TooLong {
            max: MAX_USERNAME_LENGTH,
        });
    }

    // No all-numeric usernames (confusion with UID)
    // Check this before InvalidFirstChar to give a more specific error
    if username.chars().all(|c| c.is_ascii_digit()) {
        return Err(ValidationError::AllNumeric);
    }

    // First character: lowercase letter or underscore
    let first = username
        .chars()
        .next()
        .expect("username non-empty checked above");
    if !first.is_ascii_lowercase() && first != '_' {
        return Err(ValidationError::InvalidFirstChar);
    }

    // Allowed: lowercase letters, digits, underscore, hyphen
    // No uppercase, no spaces, no special characters
    for c in username.chars() {
        if !c.is_ascii_lowercase() && !c.is_ascii_digit() && c != '_' && c != '-' {
            return Err(ValidationError::InvalidChar(c));
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    // Valid usernames

    #[test]
    fn test_valid_simple_username() {
        assert!(validate_username("alice").is_ok());
    }

    #[test]
    fn test_valid_username_with_underscore() {
        assert!(validate_username("bob_smith").is_ok());
    }

    #[test]
    fn test_valid_username_with_hyphen() {
        assert!(validate_username("user-1").is_ok());
    }

    #[test]
    fn test_valid_username_starting_with_underscore() {
        assert!(validate_username("_service").is_ok());
    }

    #[test]
    fn test_valid_username_with_numbers() {
        assert!(validate_username("user123").is_ok());
    }

    #[test]
    fn test_valid_single_char() {
        assert!(validate_username("a").is_ok());
        assert!(validate_username("_").is_ok());
    }

    #[test]
    fn test_valid_max_length() {
        let username = "a".repeat(MAX_USERNAME_LENGTH);
        assert!(validate_username(&username).is_ok());
    }

    // Invalid usernames - empty

    #[test]
    fn test_invalid_empty() {
        assert_eq!(validate_username(""), Err(ValidationError::Empty));
    }

    // Invalid usernames - too long

    #[test]
    fn test_invalid_too_long() {
        let username = "a".repeat(MAX_USERNAME_LENGTH + 1);
        assert_eq!(
            validate_username(&username),
            Err(ValidationError::TooLong {
                max: MAX_USERNAME_LENGTH
            })
        );
    }

    // Invalid usernames - uppercase

    #[test]
    fn test_invalid_uppercase_first() {
        assert_eq!(
            validate_username("Alice"),
            Err(ValidationError::InvalidFirstChar)
        );
    }

    #[test]
    fn test_invalid_uppercase_middle() {
        assert_eq!(
            validate_username("aLice"),
            Err(ValidationError::InvalidChar('L'))
        );
    }

    // Invalid usernames - all numeric
    // Note: AllNumeric is checked before InvalidFirstChar to give a more
    // specific error message for pure numeric strings.

    #[test]
    fn test_invalid_all_numeric() {
        assert_eq!(validate_username("123"), Err(ValidationError::AllNumeric));
        assert_eq!(
            validate_username("12345678"),
            Err(ValidationError::AllNumeric)
        );
    }

    // Invalid usernames - special characters

    #[test]
    fn test_invalid_at_sign() {
        assert_eq!(
            validate_username("user@domain"),
            Err(ValidationError::InvalidChar('@'))
        );
    }

    #[test]
    fn test_invalid_dot() {
        assert_eq!(
            validate_username("user.name"),
            Err(ValidationError::InvalidChar('.'))
        );
    }

    #[test]
    fn test_invalid_space() {
        assert_eq!(
            validate_username("user name"),
            Err(ValidationError::InvalidChar(' '))
        );
    }

    #[test]
    fn test_invalid_slash() {
        assert_eq!(
            validate_username("user/name"),
            Err(ValidationError::InvalidChar('/'))
        );
    }

    #[test]
    fn test_invalid_colon() {
        assert_eq!(
            validate_username("user:name"),
            Err(ValidationError::InvalidChar(':'))
        );
    }

    // Invalid usernames - starting with digit

    #[test]
    fn test_invalid_starts_with_digit() {
        assert_eq!(
            validate_username("1user"),
            Err(ValidationError::InvalidFirstChar)
        );
    }

    // Invalid usernames - path traversal attempts

    #[test]
    fn test_invalid_path_traversal() {
        // "../etc" starts with '.', which fails InvalidFirstChar
        assert_eq!(
            validate_username("../etc"),
            Err(ValidationError::InvalidFirstChar)
        );
        // Path traversal with valid first char - catches '/' before '.'
        assert_eq!(
            validate_username("a/../etc"),
            Err(ValidationError::InvalidChar('/'))
        );
        // Dot notation also rejected
        assert_eq!(
            validate_username("a..b"),
            Err(ValidationError::InvalidChar('.'))
        );
    }

    #[test]
    fn test_invalid_shell_chars() {
        assert_eq!(
            validate_username("user;id"),
            Err(ValidationError::InvalidChar(';'))
        );
        assert_eq!(
            validate_username("user|cat"),
            Err(ValidationError::InvalidChar('|'))
        );
        assert_eq!(
            validate_username("user$var"),
            Err(ValidationError::InvalidChar('$'))
        );
    }

    // Error message tests

    #[test]
    fn test_error_messages() {
        assert_eq!(
            ValidationError::Empty.to_string(),
            "username cannot be empty"
        );
        assert_eq!(
            ValidationError::TooLong { max: 32 }.to_string(),
            "username exceeds maximum length of 32 characters"
        );
        assert_eq!(
            ValidationError::InvalidFirstChar.to_string(),
            "username must start with a lowercase letter or underscore"
        );
        assert_eq!(
            ValidationError::InvalidChar('@').to_string(),
            "username contains invalid character: '@'"
        );
        assert_eq!(
            ValidationError::AllNumeric.to_string(),
            "username cannot be all numeric"
        );
    }
}
