//! A Vulkan device (lavapipe on a machine without a GPU), or with the `metal` feature a Metal one, and canvas
//! readback, for the tests.

#![allow(dead_code)]

use std::future::Future;
use std::task::{Context, Poll, Waker};

pub fn block<F: Future>(f: F) -> F::Output {
    let mut f = std::pin::pin!(f);
    loop {
        if let Poll::Ready(v) = f.as_mut().poll(&mut Context::from_waker(Waker::noop())) {
            return v;
        }
        std::thread::yield_now();
    }
}

pub fn adapter() -> wgpu::Adapter {
    let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
        backends: if cfg!(feature = "metal") {
            wgpu::Backends::METAL
        } else {
            wgpu::Backends::VULKAN
        },
        ..wgpu::InstanceDescriptor::new_without_display_handle()
    });
    block(instance.request_adapter(&wgpu::RequestAdapterOptions::default())).expect("an adapter")
}

pub fn device() -> (wgpu::Device, wgpu::Queue) {
    device_of(adapter())
}

/// Lets a test hang the GPU on purpose: `PSYCHOSCRIPT_GPU_REAL_HANGS=1` runs it on any adapter.
pub const REAL_HANGS: &str = "PSYCHOSCRIPT_GPU_REAL_HANGS";

/// Whether a test that hangs the GPU on purpose may run on this adapter: a software one (lavapipe, llvmpipe), where
/// a hang only keeps CPU threads busy, or any with the opt-in. On a real GPU it trips the watchdog (macOS's may
/// blame and lose other apps' work), so there it needs the machine owner's OK first: `Err` says why it's skipped.
pub fn may_hang(name: &str, device_type: wgpu::DeviceType, opted_in: bool) -> Result<(), String> {
    let lower = name.to_lowercase();
    if opted_in
        || device_type == wgpu::DeviceType::Cpu
        || lower.contains("llvmpipe")
        || lower.contains("lavapipe")
    {
        return Ok(());
    }
    Err(format!(
        "skipped: it hangs the GPU on purpose, so it runs only on a software adapter (lavapipe or llvmpipe), not \
         on {name} ({device_type:?}); with the GPU's owner's OK, set {REAL_HANGS}=1 to run it here"
    ))
}

/// A device for a test that hangs the GPU on purpose, or `None` (with the note printed) where it may not
/// ([`may_hang`]). Nothing reaches the GPU before the check.
pub fn hang_device() -> Option<(wgpu::Device, wgpu::Queue)> {
    let adapter = adapter();
    let info = adapter.get_info();
    let opted_in = std::env::var(REAL_HANGS).is_ok_and(|v| v == "1");
    match may_hang(&info.name, info.device_type, opted_in) {
        Ok(()) => Some(device_of(adapter)),
        Err(note) => {
            eprintln!("{note}");
            None
        }
    }
}

fn device_of(adapter: wgpu::Adapter) -> (wgpu::Device, wgpu::Queue) {
    let info = adapter.get_info();
    eprintln!(
        "adapter: {} ({:?}, {:?})",
        info.name, info.backend, info.device_type
    );
    block(adapter.request_device(&wgpu::DeviceDescriptor {
        required_limits: psychoscript_gpu::device_limits(),
        ..Default::default()
    }))
    .expect("a device")
}

/// A texture's RGBA8 pixels, row by row.
pub fn read(device: &wgpu::Device, queue: &wgpu::Queue, t: &wgpu::Texture) -> Vec<[u8; 4]> {
    let (w, h) = (t.width(), t.height());
    let row = (w * 4).div_ceil(256) * 256;
    let buffer = device.create_buffer(&wgpu::BufferDescriptor {
        label: None,
        size: (row * h) as u64,
        usage: wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST,
        mapped_at_creation: false,
    });
    let mut e = device.create_command_encoder(&Default::default());
    e.copy_texture_to_buffer(
        t.as_image_copy(),
        wgpu::TexelCopyBufferInfo {
            buffer: &buffer,
            layout: wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(row),
                rows_per_image: None,
            },
        },
        t.size(),
    );
    queue.submit([e.finish()]);
    buffer
        .slice(..)
        .map_async(wgpu::MapMode::Read, |r| r.unwrap());
    device.poll(wgpu::PollType::wait_indefinitely()).unwrap();
    let data = buffer.slice(..).get_mapped_range().unwrap();
    let mut out = Vec::with_capacity((w * h) as usize);
    for y in 0..h {
        for x in 0..w {
            let at = (y * row + x * 4) as usize;
            out.push([data[at], data[at + 1], data[at + 2], data[at + 3]]);
        }
    }
    out
}
