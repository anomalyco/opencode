// Native proxy authentication primitives.
//
// Windows uses SSPI (Negotiate/Kerberos + NTLM). macOS/Linux use GSSAPI with
// SPNEGO. The JS-side interface is defined in ../src/index.ts and mirrored by
// @opencode-ai/core's proxy/native.ts.
//
// This scaffold is not built in the local (no-Rust-toolchain) environment; CI
// compiles it per target with napi-rs.

use napi_derive::napi;

#[napi]
pub fn negotiate(spn: String) -> napi::Result<Vec<u8>> {
  imp::negotiate(&spn).map_err(|error| napi::Error::from_reason(error))
}

#[napi]
pub fn ntlm_create_type1(domain: Option<String>, workstation: Option<String>) -> Vec<u8> {
  imp::ntlm_create_type1(domain.as_deref(), workstation.as_deref())
}

#[napi]
pub fn ntlm_create_type3(
  type2: Vec<u8>,
  username: String,
  password: String,
  domain: Option<String>,
) -> napi::Result<Vec<u8>> {
  imp::ntlm_create_type3(&type2, &username, &password, domain.as_deref())
    .map_err(|error| napi::Error::from_reason(error))
}

#[cfg(windows)]
mod imp {
  // SSPI AcquireCredentialsHandle / InitializeSecurityContext with SPN
  // "HTTP/<proxy-host>". Returns the SPNEGO token to send as Proxy-Authorization.
  pub fn negotiate(spn: &str) -> Result<Vec<u8>, String> {
    Err(format!("SSPI negotiate not yet implemented for {spn}"))
  }

  pub fn ntlm_create_type1(_domain: Option<&str>, _workstation: Option<&str>) -> Vec<u8> {
    Vec::new()
  }

  pub fn ntlm_create_type3(
    _type2: &[u8],
    _username: &str,
    _password: &str,
    _domain: Option<&str>,
  ) -> Result<Vec<u8>, String> {
    Err("NTLM type3 not yet implemented".to_string())
  }
}

#[cfg(unix)]
mod imp {
  // GSSAPI gss_init_sec_context with the SPNEGO mechanism OID.
  pub fn negotiate(spn: &str) -> Result<Vec<u8>, String> {
    Err(format!("GSSAPI negotiate not yet implemented for {spn}"))
  }

  pub fn ntlm_create_type1(_domain: Option<&str>, _workstation: Option<&str>) -> Vec<u8> {
    Vec::new()
  }

  pub fn ntlm_create_type3(
    _type2: &[u8],
    _username: &str,
    _password: &str,
    _domain: Option<&str>,
  ) -> Result<Vec<u8>, String> {
    Err("NTLM type3 not yet implemented".to_string())
  }
}
