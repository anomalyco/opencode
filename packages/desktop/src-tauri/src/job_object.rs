//! Windows Job Object for reliable child process cleanup.
//!
//! This module provides a wrapper around Windows Job Objects with the
//! `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` flag set. When the job object handle
//! is closed (including when the parent process exits or crashes), Windows
//! automatically terminates all processes assigned to the job.
//!
//! This is more reliable than manual cleanup because it works even if:
//! - The parent process crashes
//! - The parent is killed via Task Manager
//! - The RunEvent::Exit handler fails to run

use std::io::{Error, Result};
#[cfg(windows)]
use std::sync::Mutex;
use windows::Win32::Foundation::{CloseHandle, HANDLE};
use windows::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
    SetInformationJobObject,
};
use windows::Win32::System::Threading::{OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE};

/// A Windows Job Object configured to kill all assigned processes when closed.
///
/// When this struct is dropped or when the owning process exits (even abnormally),
/// Windows will automatically terminate all processes that have been assigned to it.
pub struct JobObject(HANDLE);

// SAFETY: HANDLE is just a pointer-sized value, and Windows job objects
// can be safely accessed from multiple threads.
unsafe impl Send for JobObject {}
unsafe impl Sync for JobObject {}

impl JobObject {
    /// Creates a new anonymous job object with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` set.
    ///
    /// When the last handle to this job is closed (including on process exit),
    /// Windows will terminate all processes assigned to the job.
    pub fn new() -> Result<Self> {
        unsafe {
            // Create an anonymous job object
            let job = CreateJobObjectW(None, None).map_err(|e| Error::other(e.message()))?;

            // Configure the job to kill all processes when the handle is closed
            let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;

            SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const std::ffi::c_void,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
            .map_err(|e| Error::other(e.message()))?;

            Ok(Self(job))
        }
    }

    /// Assigns a process to this job object by its process ID.
    ///
    /// Once assigned, the process will be terminated when this job object is dropped
    /// or when the owning process exits.
    ///
    /// # Arguments
    /// * `pid` - The process ID of the process to assign
    pub fn assign_pid(&self, pid: u32) -> Result<()> {
        unsafe {
            // Open a handle to the process with the minimum required permissions
            // PROCESS_SET_QUOTA and PROCESS_TERMINATE are required by AssignProcessToJobObject
            let process = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, false, pid)
                .map_err(|e| Error::other(e.message()))?;

            // Assign the process to the job
            let result = AssignProcessToJobObject(self.0, process);

            // Close our handle to the process - the job object maintains its own reference
            let _ = CloseHandle(process);

            result.map_err(|e| Error::other(e.message()))
        }
    }
}

impl Drop for JobObject {
    fn drop(&mut self) {
        unsafe {
            // When this handle is closed and it's the last handle to the job,
            // Windows will terminate all processes in the job due to KILL_ON_JOB_CLOSE
            let _ = CloseHandle(self.0);
        }
    }
}

/// Holds the Windows Job Object that ensures child processes are killed when the app exits.
/// On Windows, when the job object handle is closed (including on crash), all assigned
/// processes are automatically terminated by the OS.
#[cfg(windows)]
pub struct JobObjectState {
    job: Mutex<Option<JobObject>>,
    error: Mutex<Option<String>>,
}

#[cfg(windows)]
impl JobObjectState {
    pub fn new() -> Self {
        match JobObject::new() {
            Ok(job) => Self {
                job: Mutex::new(Some(job)),
                error: Mutex::new(None),
            },
            Err(e) => {
                eprintln!("Failed to create job object: {e}");
                Self {
                    job: Mutex::new(None),
                    error: Mutex::new(Some(format!("Failed to create job object: {e}"))),
                }
            }
        }
    }

    pub fn assign_pid(&self, pid: u32) {
        if let Some(job) = self.job.lock().unwrap().as_ref() {
            if let Err(e) = job.assign_pid(pid) {
                eprintln!("Failed to assign process {pid} to job object: {e}");
                *self.error.lock().unwrap() =
                    Some(format!("Failed to assign process to job object: {e}"));
            } else {
                println!("Assigned process {pid} to job object for automatic cleanup");
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_job_object_creation() {
        let job = JobObject::new();
        assert!(job.is_ok(), "Failed to create job object: {:?}", job.err());
    }
}
