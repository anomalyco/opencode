use opencode_machine_worker::join::{self, Reach};
use opencode_machine_worker::link::{Dial, DialOptions, Identity, MESSAGE_1_LEN};

#[test]
fn public_api_decodes_join_and_starts_dial() {
    let literal = "ocjoin_eyJ2IjoxLCJob21lIjoiQVFFQkFRRUJBUUVCQVFFQkFRRUJBUUVCQVFFQkFRRUJBUUVCQVFFQkFRRSIsInNlY3JldCI6IkFnSUNBZ0lDQWdJQ0FnSUNBZ0lDQWdJQ0FnSUNBZ0lDQWdJQ0FnSUNBZ0kiLCJleHBpcmVzIjoxNzY3MjI1NjAwMDAwLCJyZWFjaCI6W3sidHlwZSI6InVybCIsInVybCI6Imh0dHBzOi8vaG9tZS5leGFtcGxlIn1dfQ";
    let decoded = join::decode(literal).expect("decode join string");
    assert_eq!(
        decoded.reach,
        vec![Reach::Url("https://home.example".to_owned())]
    );

    let identity = Identity::from_seed([7u8; 32]);
    let options = DialOptions::new(decoded.home, identity, Some(decoded.secret));
    let (dial, message_1) = Dial::start(options).expect("Dial::start");
    assert_eq!(message_1.len(), MESSAGE_1_LEN);

    // Short message 2 is refused cleanly with the opaque public error.
    let err = dial.read_message_2(&[0u8; 10]).unwrap_err();
    assert_eq!(err.to_string(), "the link was refused");
}
