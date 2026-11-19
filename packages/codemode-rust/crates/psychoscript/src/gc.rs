//! Heap accounting, for measuring automatic memory management (`gc-stats` builds only).
//!
//! A run publishes its counts to its [`Run`](crate::Run) each time it stops for the host, so a harness reads them
//! between events with [`Run::heap_stats`](crate::Run::heap_stats). Collectors add their pauses as they make them.

use crate::vm::Vm;

/// A run's heap as of its last stop: live and peak slots of each kind, and what collecting cost.
#[derive(Clone, Debug, Default)]
pub struct HeapStats {
    pub objects: u64,
    pub cells: u64,
    pub strings: u64,
    pub peak_objects: u64,
    pub peak_cells: u64,
    pub peak_strings: u64,
    /// Collection steps taken, and their total and individual durations.
    pub steps: u64,
    pub gc_ns: u64,
    pub pauses_ns: Vec<u32>,
}

impl Vm {
    /// Live slots now: objects, cells, strings. A collector that reuses slots subtracts its free ones.
    pub fn heap_counts(&self) -> (u64, u64, u64) {
        #[cfg(feature = "gc-sticky")]
        let (objects, cells, strings) = self.free_counts();
        #[cfg(not(feature = "gc-sticky"))]
        let (objects, cells, strings) = (0, 0, 0);
        (
            (self.heap.len() - objects) as u64,
            (self.cells.len() - cells) as u64,
            (self.atoms.bufs.len() - strings) as u64,
        )
    }

    /// Copies the counts to the run's stats. A collector also calls it just before it frees, so the peaks hold.
    pub fn publish_stats(&self) {
        let (objects, cells, strings) = self.heap_counts();
        let mut s = self.host.run.stats();
        s.objects = objects;
        s.cells = cells;
        s.strings = strings;
        s.peak_objects = s.peak_objects.max(objects);
        s.peak_cells = s.peak_cells.max(cells);
        s.peak_strings = s.peak_strings.max(strings);
    }

    /// Records one collection step of `ns` nanoseconds.
    #[cfg_attr(not(feature = "gc-sticky"), allow(dead_code))]
    pub fn record_pause(&self, ns: u64) {
        let mut s = self.host.run.stats();
        s.steps += 1;
        s.gc_ns += ns;
        s.pauses_ns.push(ns.min(u32::MAX as u64) as u32);
    }
}
