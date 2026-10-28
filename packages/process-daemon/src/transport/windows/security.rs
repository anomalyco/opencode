use std::io;
use std::os::windows::io::AsRawHandle;
use std::ptr::null_mut;

use windows_sys::Win32::Foundation::{HANDLE, LocalFree};
use windows_sys::Win32::Security::Authorization::{
    ConvertSidToStringSidW, ConvertStringSecurityDescriptorToSecurityDescriptorW, GetSecurityInfo,
    SDDL_REVISION_1, SE_FILE_OBJECT, SetSecurityInfo,
};
use windows_sys::Win32::Security::{
    ACCESS_ALLOWED_ACE, ACE_HEADER, DACL_SECURITY_INFORMATION, EqualSid, GetAce,
    GetSecurityDescriptorControl, GetSecurityDescriptorDacl, GetSecurityDescriptorOwner,
    GetTokenInformation, OWNER_SECURITY_INFORMATION, PROTECTED_DACL_SECURITY_INFORMATION,
    SE_DACL_PROTECTED, SECURITY_ATTRIBUTES, TOKEN_QUERY, TOKEN_USER, TokenUser,
};
use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

use super::owned_handle;

pub(crate) struct PrivateSecurity(*mut core::ffi::c_void);

impl PrivateSecurity {
    pub fn new() -> io::Result<Self> {
        let sid = current_user_sid()?;
        // Protected DACL: only the current user, no inherited Everyone/network
        // grants. Explicit owner also avoids inheriting an Administrators owner.
        let sddl = format!("O:{sid}D:P(A;;GA;;;{sid})\0")
            .encode_utf16()
            .collect::<Vec<_>>();
        let mut descriptor = null_mut();
        // SAFETY: valid NUL-terminated SDDL; successful allocation uses LocalFree.
        if unsafe {
            ConvertStringSecurityDescriptorToSecurityDescriptorW(
                sddl.as_ptr(),
                SDDL_REVISION_1,
                &mut descriptor,
                null_mut(),
            )
        } == 0
        {
            return Err(io::Error::last_os_error());
        }
        Ok(Self(descriptor))
    }

    pub fn attributes(&self) -> SECURITY_ATTRIBUTES {
        SECURITY_ATTRIBUTES {
            nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: self.0,
            bInheritHandle: 0,
        }
    }

    /// Existing files/directories are never adopted from a different owner.
    /// Apply the protected current-user DACL before any secrets are published.
    pub fn make_private(&self, handle: HANDLE) -> io::Result<()> {
        self.check_owner(handle)?;
        let mut present = 0;
        let mut defaulted = 0;
        let mut dacl = null_mut();
        // SAFETY: self owns a valid descriptor and returned DACL remains inside it.
        if unsafe { GetSecurityDescriptorDacl(self.0, &mut present, &mut dacl, &mut defaulted) }
            == 0
        {
            return Err(io::Error::last_os_error());
        }
        // SAFETY: the live handle is opened with WRITE_DAC; dacl is valid above.
        let error = unsafe {
            SetSecurityInfo(
                handle,
                SE_FILE_OBJECT,
                DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
                null_mut(),
                null_mut(),
                dacl,
                null_mut(),
            )
        };
        if error != 0 {
            return Err(io::Error::from_raw_os_error(error as i32));
        }
        Ok(())
    }

    pub fn check_private(&self, handle: HANDLE) -> io::Result<()> {
        let actual = self.check_owner(handle)?;
        let mut present = 0;
        let mut defaulted = 0;
        let mut dacl = null_mut();
        let mut control = 0;
        let mut revision = 0;
        // SAFETY: actual owns a valid Windows descriptor throughout inspection.
        if unsafe { GetSecurityDescriptorDacl(actual.0, &mut present, &mut dacl, &mut defaulted) }
            == 0
            || unsafe { GetSecurityDescriptorControl(actual.0, &mut control, &mut revision) } == 0
        {
            return Err(io::Error::last_os_error());
        }
        if present == 0 || dacl.is_null() || control & SE_DACL_PROTECTED == 0 {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "unprotected PTY storage DACL",
            ));
        }
        let mut ace = null_mut();
        // SAFETY: dacl is non-null and belongs to the live actual descriptor.
        if unsafe { (*dacl).AceCount } != 1 || unsafe { GetAce(dacl, 0, &mut ace) } == 0 {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "PTY storage must grant only the current user",
            ));
        }
        // ACCESS_ALLOWED_ACE_TYPE is zero. Other ACE layouts must not be cast.
        // SAFETY: Windows returned an ACE from a validated security descriptor.
        if unsafe { (*ace.cast::<ACE_HEADER>()).AceType } != 0 {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "unexpected PTY storage ACE",
            ));
        }
        // SAFETY: an ACCESS_ALLOWED_ACE has an inline SID beginning at SidStart.
        let sid = unsafe { (&raw mut (*ace.cast::<ACCESS_ALLOWED_ACE>()).SidStart).cast() };
        if !self.is_current_user(sid)? {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "PTY storage grants another principal",
            ));
        }
        Ok(())
    }

    fn check_owner(&self, handle: HANDLE) -> io::Result<Self> {
        let mut owner = null_mut();
        let mut descriptor = null_mut();
        // SAFETY: query a live file handle. Descriptor is a unique LocalFree allocation.
        let error = unsafe {
            GetSecurityInfo(
                handle,
                SE_FILE_OBJECT,
                OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION,
                &mut owner,
                null_mut(),
                null_mut(),
                null_mut(),
                &mut descriptor,
            )
        };
        if error != 0 {
            return Err(io::Error::from_raw_os_error(error as i32));
        }
        let actual = Self(descriptor);
        if owner.is_null() || !self.is_current_user(owner)? {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "PTY storage is not owned by the current user",
            ));
        }
        Ok(actual)
    }

    fn is_current_user(&self, sid: *mut core::ffi::c_void) -> io::Result<bool> {
        let mut owner = null_mut();
        let mut defaulted = 0;
        // SAFETY: self owns the descriptor; supplied SID belongs to another live descriptor.
        if unsafe { GetSecurityDescriptorOwner(self.0, &mut owner, &mut defaulted) } == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(unsafe { EqualSid(owner, sid) } != 0)
    }
}

impl Drop for PrivateSecurity {
    fn drop(&mut self) {
        // SAFETY: this is the unique descriptor allocation returned by conversion.
        unsafe {
            LocalFree(self.0);
        }
    }
}

fn current_user_sid() -> io::Result<String> {
    let mut token = null_mut();
    // SAFETY: query the current process token; successful handle is adopted below.
    if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) } == 0 {
        return Err(io::Error::last_os_error());
    }
    let token = owned_handle(token)?;
    let mut length = 0;
    // SAFETY: first call only determines the variable-sized token information buffer.
    unsafe {
        GetTokenInformation(token.as_raw_handle(), TokenUser, null_mut(), 0, &mut length);
    }
    if length == 0 {
        return Err(io::Error::last_os_error());
    }
    // usize provides the alignment TOKEN_USER requires, unlike Vec<u8>.
    let mut buffer = vec![0_usize; (length as usize).div_ceil(size_of::<usize>())];
    // SAFETY: buffer is aligned, large enough, and retained through SID conversion.
    if unsafe {
        GetTokenInformation(
            token.as_raw_handle(),
            TokenUser,
            buffer.as_mut_ptr().cast(),
            length,
            &mut length,
        )
    } == 0
    {
        return Err(io::Error::last_os_error());
    }
    // SAFETY: a successful TokenUser query initializes a TOKEN_USER at this address.
    let user = unsafe { &*buffer.as_ptr().cast::<TOKEN_USER>() };
    let mut text = null_mut();
    // SAFETY: the queried token owns a valid SID; returned string uses LocalFree.
    if unsafe { ConvertSidToStringSidW(user.User.Sid, &mut text) } == 0 {
        return Err(io::Error::last_os_error());
    }
    // SAFETY: conversion returns a NUL-terminated wide string allocated by Windows.
    let sid = unsafe {
        let mut length = 0;
        while *text.add(length) != 0 {
            length += 1;
        }
        let sid = String::from_utf16_lossy(std::slice::from_raw_parts(text, length));
        LocalFree(text.cast());
        sid
    };
    Ok(sid)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Foundation::{GENERIC_READ, GENERIC_WRITE};
    use windows_sys::Win32::Storage::FileSystem::{
        CREATE_NEW, CreateFileW, READ_CONTROL, WRITE_DAC,
    };

    #[test]
    fn rejects_public_storage_acl_and_privatises_only_our_owned_file() {
        let path = std::env::temp_dir().join(format!("pty-acl-{:032x}", rand::random::<u128>()));
        let wide = path
            .as_os_str()
            .encode_wide()
            .chain([0])
            .collect::<Vec<_>>();
        let sid = current_user_sid().unwrap();
        let public = format!("O:{sid}D:P(A;;GA;;;WD)\0")
            .encode_utf16()
            .collect::<Vec<_>>();
        let mut descriptor = null_mut();
        // SAFETY: valid SDDL; allocation is immediately adopted by the RAII owner.
        assert_ne!(
            unsafe {
                ConvertStringSecurityDescriptorToSecurityDescriptorW(
                    public.as_ptr(),
                    SDDL_REVISION_1,
                    &mut descriptor,
                    null_mut(),
                )
            },
            0
        );
        let public = PrivateSecurity(descriptor);
        // SAFETY: a unique temporary file, live private owner + deliberately public
        // test DACL. No secrets are written while the DACL is permissive.
        let file = owned_handle(unsafe {
            CreateFileW(
                wide.as_ptr(),
                GENERIC_READ | GENERIC_WRITE | READ_CONTROL | WRITE_DAC,
                0,
                &public.attributes(),
                CREATE_NEW,
                0,
                null_mut(),
            )
        })
        .unwrap();
        let private = PrivateSecurity::new().unwrap();
        assert!(private.check_private(file.as_raw_handle()).is_err());
        private.make_private(file.as_raw_handle()).unwrap();
        private.check_private(file.as_raw_handle()).unwrap();
        drop(file);
        std::fs::remove_file(path).unwrap();
    }
}
