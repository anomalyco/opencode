pub mod canvas;
pub mod color;
pub mod drawing;
mod entities;
pub mod geometry;
pub mod spatial;
pub mod text;
mod wide;

/// Whether a group with `id` opened inside `parent` would be its own ancestor. Groups name their parent by ID and
/// IDs may repeat, so `groups` gives every (ID, parent ID) pair; a cycle among them would nest without end.
pub(crate) fn nests_in_itself<'a>(
    id: &str,
    parent: Option<&'a str>,
    groups: impl Iterator<Item = (&'a str, Option<&'a str>)> + Clone,
) -> bool {
    let mut ancestors: Vec<&str> = parent.into_iter().collect();
    let mut seen = std::collections::HashSet::new();
    while let Some(ancestor) = ancestors.pop() {
        if ancestor == id {
            return true;
        }
        if seen.insert(ancestor) {
            ancestors.extend(groups.clone().filter(|group| group.0 == ancestor).filter_map(|group| group.1));
        }
    }
    false
}
