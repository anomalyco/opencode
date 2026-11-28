use std::collections::{BTreeMap, BTreeSet};

use indexmap::IndexMap;

use super::geometry::{Bounds, Point, orthogonal_path_points};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Role {
    Body,
    Boundary,
    Terminal,
    Route,
    Label,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct SpatialSpan {
    pub y: i32,
    pub from_x: i32,
    pub to_x: i32,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Claim {
    pub id: String,
    pub owner: String,
    pub role: Role,
    pub spans: Vec<SpatialSpan>,
}

#[derive(Clone, Debug)]
pub struct Contact {
    pub owner: String,
    pub points: Vec<Point>,
}

#[derive(Clone, Copy, Debug, Default)]
pub struct Clearance {
    pub x: i32,
    pub y: i32,
}

/// `SpatialCollisionPolicy.clearance`: one clearance, or one per existing claim's role.
#[derive(Clone, Debug, Default)]
pub enum ClearancePolicy {
    #[default]
    None,
    All(Clearance),
    ByRole(Vec<(Role, Clearance)>),
}

#[derive(Clone, Debug, Default)]
pub struct Policy {
    pub contacts: Vec<Contact>,
    pub clearance: ClearancePolicy,
}

fn span(y: i32, from: i32, to: i32) -> SpatialSpan {
    SpatialSpan { y, from_x: from.min(to), to_x: from.max(to) }
}

pub fn rect_spans(bounds: &Bounds) -> Vec<SpatialSpan> {
    (0..bounds.height.max(0))
        .map(|offset| span(bounds.top + offset, bounds.left, bounds.left + bounds.width - 1))
        .collect()
}

pub fn path_spans(points: &[Point]) -> Vec<SpatialSpan> {
    let mut cells: BTreeMap<i32, BTreeSet<i32>> = BTreeMap::new();
    if points.len() == 1 {
        cells.entry(points[0].y).or_default().insert(points[0].x);
    }
    for point in orthogonal_path_points(points) {
        cells.entry(point.y).or_default().insert(point.x);
    }
    let mut spans = Vec::new();
    for (y, xs) in cells {
        let mut iter = xs.into_iter();
        let Some(first) = iter.next() else { continue };
        let (mut start, mut end) = (first, first);
        for x in iter {
            if x == end + 1 {
                end = x;
                continue;
            }
            spans.push(span(y, start, end));
            start = x;
            end = x;
        }
        spans.push(span(y, start, end));
    }
    spans
}

pub fn rect_claim(id: impl Into<String>, owner: impl Into<String>, role: Role, bounds: &Bounds) -> Claim {
    Claim { id: id.into(), owner: owner.into(), role, spans: rect_spans(bounds) }
}

pub fn path_claim(id: impl Into<String>, owner: impl Into<String>, role: Role, points: &[Point]) -> Claim {
    Claim { id: id.into(), owner: owner.into(), role, spans: path_spans(points) }
}

#[derive(Clone, Debug, Default)]
pub struct SpatialIndex {
    claims: Vec<Claim>,
}

impl SpatialIndex {
    pub fn claims(&self) -> &[Claim] {
        &self.claims
    }

    pub fn add(&self, claims: impl IntoIterator<Item = Claim>) -> SpatialIndex {
        let claims = claims.into_iter().map(|mut claim| {
            claim.spans.sort();
            claim
        });
        self.overlay(&SpatialIndex { claims: claims.collect() })
    }

    /// Claims of both, sorted by ID; a later claim replaces one with the same ID.
    pub fn overlay(&self, other: &SpatialIndex) -> SpatialIndex {
        let mut claims: IndexMap<String, Claim> =
            self.claims.iter().map(|claim| (claim.id.clone(), claim.clone())).collect();
        for claim in &other.claims {
            claims.insert(claim.id.clone(), claim.clone());
        }
        let mut claims: Vec<Claim> = claims.into_values().collect();
        claims.sort_by(|a, b| a.id.cmp(&b.id));
        SpatialIndex { claims }
    }

    pub fn is_free(&self, moving: &Claim, policy: &Policy) -> bool {
        for existing in &self.claims {
            if moving.owner == existing.owner || (moving.role == Role::Route && existing.role == Role::Route) {
                continue;
            }
            let clearance = match &policy.clearance {
                ClearancePolicy::None => Clearance::default(),
                ClearancePolicy::All(clearance) => *clearance,
                ClearancePolicy::ByRole(roles) => roles
                    .iter()
                    .find(|(role, _)| *role == existing.role)
                    .map_or(Clearance::default(), |(_, clearance)| *clearance),
            };
            for moving_span in &moving.spans {
                for dy in -clearance.y..=clearance.y {
                    let y = moving_span.y + dy;
                    let from = moving_span.from_x - clearance.x;
                    let to = moving_span.to_x + clearance.x;
                    for existing_span in &existing.spans {
                        if existing_span.y != y {
                            continue;
                        }
                        for x in from.max(existing_span.from_x)..=to.min(existing_span.to_x) {
                            let occupies = moving.spans.iter().any(|s| s.y == y && x >= s.from_x && x <= s.to_x);
                            let contact = policy.contacts.iter().any(|contact| {
                                contact.owner == existing.owner
                                    && contact.points.iter().any(|point| point.x == x && point.y == y)
                            });
                            if !(occupies && contact) {
                                return false;
                            }
                        }
                    }
                }
            }
        }
        true
    }
}

/// The cells of a set of claims, by role: answers [`SpatialIndex::is_free`] for a claim with no owner or contacts
/// among them from per-row counts, instead of a walk over every claim.
pub struct CellIndex {
    left: i32,
    top: i32,
    width: i32,
    rows: i32,
    roles: Vec<u8>,
    /// For each role and row, how many of the row's first columns hold that role.
    counts: Vec<u32>,
}

const ROLES: [Role; 5] = [Role::Label, Role::Route, Role::Body, Role::Boundary, Role::Terminal];

fn role_index(role: Role) -> usize {
    ROLES.iter().position(|candidate| *candidate == role).unwrap_or(0)
}

impl CellIndex {
    pub fn new(index: &SpatialIndex) -> Self {
        let mut cells = Self { left: 0, top: 0, width: 0, rows: 0, roles: Vec::new(), counts: Vec::new() };
        let spans = || index.claims.iter().flat_map(|claim| &claim.spans);
        if let (Some(left), Some(right), Some(top), Some(bottom)) = (
            spans().map(|span| span.from_x).min(),
            spans().map(|span| span.to_x).max(),
            spans().map(|span| span.y).min(),
            spans().map(|span| span.y).max(),
        ) {
            cells.cover(left, top, right, bottom);
        }
        for claim in &index.claims {
            cells.mark(claim);
        }
        for role in 0..ROLES.len() {
            for row in 0..cells.rows {
                cells.count(role, row);
            }
        }
        cells
    }

    pub fn add(&mut self, claim: &Claim) {
        let Some(left) = claim.spans.iter().map(|span| span.from_x).min() else { return };
        let right = claim.spans.iter().map(|span| span.to_x).max().unwrap_or(left);
        let top = claim.spans.iter().map(|span| span.y).min().unwrap_or(0);
        let bottom = claim.spans.iter().map(|span| span.y).max().unwrap_or(top);
        self.cover(left, top, right, bottom);
        self.mark(claim);
        for row in top..=bottom {
            self.count(role_index(claim.role), row - self.top);
        }
    }

    fn mark(&mut self, claim: &Claim) {
        let role = role_index(claim.role);
        for span in &claim.spans {
            let row = span.y - self.top;
            for column in span.from_x - self.left..=span.to_x - self.left {
                self.roles[(row * self.width + column) as usize] |= 1 << role;
            }
        }
    }

    /// Grows the grid, with a margin, to hold the cells from `(left, top)` to `(right, bottom)`.
    fn cover(&mut self, left: i32, top: i32, right: i32, bottom: i32) {
        let inside = |cells: &Self| {
            left >= cells.left
                && top >= cells.top
                && right < cells.left + cells.width
                && bottom < cells.top + cells.rows
        };
        if self.width > 0 && inside(self) {
            return;
        }
        let empty = self.width == 0;
        let new_left = if empty { left } else { self.left.min(left) } - 32;
        let new_top = if empty { top } else { self.top.min(top) } - 32;
        let new_right = if empty { right } else { (self.left + self.width - 1).max(right) } + 32;
        let new_bottom = if empty { bottom } else { (self.top + self.rows - 1).max(bottom) } + 32;
        let (width, rows) = (new_right - new_left + 1, new_bottom - new_top + 1);
        let mut roles = vec![0; (width * rows) as usize];
        for row in 0..self.rows {
            for column in 0..self.width {
                let at = ((row + self.top - new_top) * width + column + self.left - new_left) as usize;
                roles[at] = self.roles[(row * self.width + column) as usize];
            }
        }
        *self = Self {
            left: new_left,
            top: new_top,
            width,
            rows,
            roles,
            counts: vec![0; ROLES.len() * (rows * (width + 1)) as usize],
        };
        for role in 0..ROLES.len() {
            for row in 0..rows {
                self.count(role, row);
            }
        }
    }

    /// Recounts `row` of `role`.
    fn count(&mut self, role: usize, row: i32) {
        let base = ((role as i32 * self.rows + row) * (self.width + 1)) as usize;
        let mut total = 0;
        for column in 0..self.width as usize {
            total += u32::from(self.roles[row as usize * self.width as usize + column] & (1 << role) != 0);
            self.counts[base + column + 1] = total;
        }
    }

    /// Whether a cell from `from` to `to` on row `y` holds `role`.
    fn any(&self, role: usize, y: i32, from: i32, to: i32) -> bool {
        let row = y - self.top;
        let (start, end) = ((from - self.left).max(0), (to - self.left + 1).min(self.width));
        if row < 0 || row >= self.rows || start >= end {
            return false;
        }
        let base = (role as i32 * self.rows + row) * (self.width + 1);
        self.counts[(base + end) as usize] > self.counts[(base + start) as usize]
    }

    /// Whether `spans` keep each role's `clearance` from every claimed cell.
    pub fn is_free(&self, spans: &[SpatialSpan], clearance: impl Fn(Role) -> Clearance) -> bool {
        ROLES.iter().enumerate().all(|(role, &kind)| {
            let clearance = clearance(kind);
            spans.iter().all(|span| {
                (span.y - clearance.y..=span.y + clearance.y)
                    .all(|y| !self.any(role, y, span.from_x - clearance.x, span.to_x + clearance.x))
            })
        })
    }
}
