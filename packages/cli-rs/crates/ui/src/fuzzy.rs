//! A port of `fuzzysort` 3.1's `go` with `keys`, `scoreFn`, and `threshold`, as `DialogSelect` calls it: the same
//! scores and the same order, ties included. Strings are compared in UTF-16 code units, as JavaScript does.
//! Accents are not removed from Latin letters (TS `remove_accents`).

const NEG: f64 = f64::NEG_INFINITY;

struct Search {
    lower: Vec<u16>,
    bitflags: u32,
    contains_space: bool,
    spaces: Vec<Search>,
}

struct Prepared {
    lower: Vec<u16>,
    bitflags: u32,
    next: Vec<usize>,
}

/// Returns the indexes of the matching targets, best first. `keys` gives each target's searchable strings,
/// and `score` combines their normalized scores.
pub fn go<T, const N: usize>(
    search: &str,
    targets: &[T],
    keys: impl Fn(&T) -> [Option<&str>; N],
    score: impl Fn(&[f64; N]) -> f64,
    threshold: f64,
) -> Vec<usize> {
    go_scored(search, targets, keys, |keys, _, _| score(keys), threshold, usize::MAX)
}

/// fuzzysort's default score over several keys: the best key, with a bonus for matching more than one.
pub fn best_key<const N: usize>(scores: &[f64; N]) -> f64 {
    let mut best = NEG;
    for &score in scores {
        let raw = denormalize(score);
        if raw > -1000.0 && best > NEG {
            best = best.max((best + raw) / 4.0);
        }
        best = best.max(raw);
    }
    normalize(best)
}

/// [`go`] whose `score` also gets fuzzysort's own normalized score for the target, the `objResults.score` a
/// TS `scoreFn` reads (the best key, with a bonus for matching several), and the target's index. At most
/// `limit` results are kept, as fuzzysort's `limit` keeps them, ties included.
pub fn go_scored<T, const N: usize>(
    search: &str,
    targets: &[T],
    keys: impl Fn(&T) -> [Option<&str>; N],
    score: impl Fn(&[f64; N], f64, usize) -> f64,
    threshold: f64,
    limit: usize,
) -> Vec<usize> {
    if search.is_empty() {
        return Vec::new();
    }
    let search = prepare_search(search);
    let threshold = denormalize(threshold);
    let mut heap = Heap::default();
    let mut partial = vec![NEG; search.spaces.len()];
    'outer: for (index, target) in targets.iter().enumerate() {
        let mut prepared: Vec<Option<Prepared>> =
            keys(target).iter().map(|key| key.filter(|key| !key.is_empty()).map(prepare)).collect();
        let bitflags = prepared.iter().flatten().fold(0, |flags, key| flags | key.bitflags);
        if search.bitflags & bitflags != search.bitflags {
            continue;
        }
        let mut best = vec![NEG; search.spaces.len()];
        let mut results = [NEG; N];
        for (key, target) in prepared.iter_mut().enumerate() {
            let Some(target) = target else { continue };
            let Some(result) = algorithm(&search, target, false, search.contains_space, &mut partial) else {
                continue;
            };
            results[key] = result;
            if search.contains_space {
                for i in 0..search.spaces.len() {
                    if partial[i] > -1000.0 && best[i] > NEG {
                        let tmp = (best[i] + partial[i]) / 4.0;
                        if tmp > best[i] {
                            best[i] = tmp;
                        }
                    }
                    if partial[i] > best[i] {
                        best[i] = partial[i];
                    }
                }
            }
        }
        if search.contains_space {
            if best.contains(&NEG) {
                continue 'outer;
            }
        } else if results.iter().all(|score| *score == NEG) {
            continue;
        }
        let combined = if search.contains_space {
            best.iter().sum()
        } else {
            results.iter().fold(NEG, |combined, &result| {
                let bonus = if result > -1000.0 && combined > NEG {
                    ((combined + result) / 4.0).max(combined)
                } else {
                    combined
                };
                bonus.max(result)
            })
        };
        let normalized = results.map(normalize);
        let total = score(&normalized, normalize(combined), index);
        if total == 0.0 || total.is_nan() {
            continue;
        }
        let total = denormalize(total);
        if total < threshold {
            continue;
        }
        if heap.len < limit {
            heap.add((total, index));
        } else if total > heap.items[0].0 {
            heap.items[0] = (total, index);
            heap.sift();
        }
    }
    let mut out = vec![0; heap.items.len()];
    for slot in (0..out.len()).rev() {
        out[slot] = heap.poll().expect("one item per slot").1;
    }
    out
}

fn normalize(score: f64) -> f64 {
    if score == NEG {
        return 0.0;
    }
    if score > 1.0 {
        return score;
    }
    std::f64::consts::E.powf(((-score + 1.0).powf(0.04307) - 1.0) * -2.0)
}

fn denormalize(score: f64) -> f64 {
    if score == 0.0 {
        return NEG;
    }
    if score > 1.0 {
        return score;
    }
    1.0 - (score.ln() / -2.0 + 1.0).powf(1.0 / 0.04307)
}

fn lower_info(text: &str) -> (Vec<u16>, u32, bool) {
    let lower: Vec<u16> = text.to_lowercase().encode_utf16().collect();
    let mut bitflags = 0u32;
    let mut space = false;
    for &code in &lower {
        if code == 32 {
            space = true;
            continue;
        }
        let bit = match code {
            97..=122 => code - 97,
            48..=57 => 26,
            0..=127 => 30,
            _ => 31,
        };
        bitflags |= 1 << bit;
    }
    (lower, bitflags, space)
}

fn prepare_search(search: &str) -> Search {
    let search = search.trim_matches(|c: char| c.is_whitespace());
    let (lower, bitflags, contains_space) = lower_info(search);
    let mut spaces = Vec::new();
    if contains_space {
        let mut seen: Vec<&str> = Vec::new();
        for word in search.split(char::is_whitespace) {
            if word.is_empty() || seen.contains(&word) {
                continue;
            }
            seen.push(word);
            spaces.push(Search { lower: lower_info(word).0, bitflags: 0, contains_space: false, spaces: Vec::new() });
        }
    }
    Search { lower, bitflags, contains_space, spaces }
}

fn prepare(target: &str) -> Prepared {
    let (lower, bitflags, _) = lower_info(target);
    Prepared { lower, bitflags, next: next_beginnings(target) }
}

fn next_beginnings(target: &str) -> Vec<usize> {
    let codes: Vec<u16> = target.encode_utf16().collect();
    let mut beginnings = Vec::new();
    let (mut was_upper, mut was_alnum) = (false, false);
    for (i, &code) in codes.iter().enumerate() {
        let upper = (65..=90).contains(&code);
        let alnum = upper || (97..=122).contains(&code) || (48..=57).contains(&code);
        if upper && !was_upper || !was_alnum || !alnum {
            beginnings.push(i);
        }
        was_upper = upper;
        was_alnum = alnum;
    }
    let len = codes.len();
    let mut next = vec![0; len];
    let mut last = beginnings.first().copied();
    let mut last_i = 0;
    for (i, slot) in next.iter_mut().enumerate() {
        if last.is_some_and(|last| last > i) {
            *slot = last.unwrap_or(len);
        } else {
            last_i += 1;
            last = beginnings.get(last_i).copied();
            *slot = last.unwrap_or(len);
        }
    }
    next
}

fn find(haystack: &[u16], needle: &[u16], from: usize) -> Option<usize> {
    if needle.is_empty() {
        return Some(from.min(haystack.len()));
    }
    (from..haystack.len().saturating_sub(needle.len() - 1)).find(|&i| haystack[i..].starts_with(needle))
}

// `algorithm`: the score of one search against one target, or `None`. Leaves the match indexes in `indexes`.
fn single(search: &[u16], target: &Prepared, indexes: &mut Vec<usize>) -> Option<f64> {
    let search_len = search.len();
    let target_len = target.lower.len();
    if search_len == 0 || target_len == 0 {
        return None;
    }
    let codes = &target.lower;
    let next = &target.next;
    let mut simple = Vec::with_capacity(search_len);
    let (mut search_i, mut target_i) = (0, 0);
    loop {
        if search[search_i] == codes[target_i] {
            simple.push(target_i);
            search_i += 1;
            if search_i == search_len {
                break;
            }
        }
        target_i += 1;
        if target_i >= target_len {
            return None;
        }
    }
    let mut strict: Vec<usize> = Vec::with_capacity(search_len);
    let mut success = false;
    search_i = 0;
    target_i = if simple[0] == 0 { 0 } else { next[simple[0] - 1] };
    let mut backtracks = 0;
    if target_i != target_len {
        loop {
            if target_i >= target_len {
                if search_i == 0 {
                    break;
                }
                backtracks += 1;
                if backtracks > 200 {
                    break;
                }
                search_i -= 1;
                let last = strict.pop().expect("a match to undo");
                target_i = next[last];
            } else if search[search_i] == codes[target_i] {
                strict.push(target_i);
                search_i += 1;
                if search_i == search_len {
                    success = true;
                    break;
                }
                target_i += 1;
            } else {
                target_i = next[target_i];
            }
        }
    }
    let mut substring = if search_len <= 1 { None } else { find(codes, search, simple[0]) };
    let mut substring_beginning = substring.is_some_and(|i| i == 0 || next[i - 1] == i);
    if let Some(found) = substring.filter(|_| !substring_beginning) {
        let mut i = 0;
        while i < next.len() {
            if i > found && (0..search_len).all(|s| codes.get(i + s) == Some(&search[s])) {
                substring = Some(i);
                substring_beginning = true;
                break;
            }
            i = next[i];
        }
    }
    let is_substring = substring.is_some();
    let score_of = |matches: &[usize]| -> f64 {
        let mut score = 0.0;
        let mut groups = 0.0;
        for i in 1..search_len {
            if matches[i] as i64 - matches[i - 1] as i64 != 1 {
                score -= matches[i] as f64;
                groups += 1.0;
            }
        }
        let unmatched = matches[search_len - 1] as f64 - matches[0] as f64 - (search_len as f64 - 1.0);
        score -= (12.0 + unmatched) * groups;
        if matches[0] != 0 {
            score -= (matches[0] * matches[0]) as f64 * 0.2;
        }
        if !success {
            score *= 1000.0;
        } else {
            let mut unique = 1;
            let mut i = next[0];
            while i < target_len {
                unique += 1;
                i = next[i];
            }
            if unique > 24 {
                score *= (unique - 24) as f64 * 10.0;
            }
        }
        let longer = (target_len as f64 - search_len as f64) / 2.0;
        score -= longer;
        let bonus = 1.0 + (search_len * search_len) as f64;
        if is_substring {
            score /= bonus;
        }
        if substring_beginning {
            score /= bonus;
        }
        score - longer
    };
    let substring_matches = |start: usize| (start..start + search_len).collect::<Vec<_>>();
    let best = match (success, substring) {
        (false, Some(start)) => substring_matches(start),
        (false, None) => simple,
        (true, Some(start)) if substring_beginning => substring_matches(start),
        (true, _) => strict,
    };
    let score = score_of(&best);
    *indexes = best;
    Some(score)
}

fn algorithm(
    search: &Search,
    target: &mut Prepared,
    allow_spaces: bool,
    partial_match: bool,
    partial: &mut [f64],
) -> Option<f64> {
    if !allow_spaces && search.contains_space {
        return spaces(search, target, partial_match, partial);
    }
    single(&search.lower, target, &mut Vec::new())
}

// `algorithmSpaces`; only the score is kept.
fn spaces(search: &Search, target: &mut Prepared, partial_match: bool, partial: &mut [f64]) -> Option<f64> {
    let mut score = 0.0;
    let mut first_seen = 0usize;
    let count = search.spaces.len();
    let mut changes: Vec<(usize, usize)> = Vec::new();
    let mut any = false;
    let mut indexes = Vec::new();
    for (i, word) in search.spaces.iter().enumerate() {
        partial[i] = NEG;
        let result = single(&word.lower, target, &mut indexes);
        let Some(result) = result else {
            if partial_match {
                continue;
            }
            for &(at, value) in changes.iter().rev() {
                target.next[at] = value;
            }
            return None;
        };
        any = true;
        if i != count - 1 && indexes.windows(2).all(|pair| pair[1] - pair[0] == 1) {
            let beginning = indexes[indexes.len() - 1] + 1;
            let replace = target.next[beginning - 1];
            for at in (0..beginning).rev() {
                if target.next[at] != replace {
                    break;
                }
                changes.push((at, replace));
                target.next[at] = beginning;
            }
        }
        score += result / count as f64;
        partial[i] = result / count as f64;
        if indexes[0] < first_seen {
            score -= (first_seen - indexes[0]) as f64 * 2.0;
        }
        first_seen = indexes[0];
    }
    if partial_match && !any {
        return None;
    }
    for &(at, value) in changes.iter().rev() {
        target.next[at] = value;
    }
    if let Some(whole) = single(&search.lower, target, &mut Vec::new()).filter(|whole| *whole > score) {
        if partial_match {
            partial.iter_mut().for_each(|slot| *slot = whole / count as f64);
        }
        return Some(whole);
    }
    Some(score)
}

// `fastpriorityqueue` as fuzzysort hacks it: a min-heap on the score, polled in this exact order.
#[derive(Default)]
struct Heap {
    items: Vec<(f64, usize)>,
    len: usize,
}

impl Heap {
    fn add(&mut self, item: (f64, usize)) {
        let mut a = self.len;
        if self.items.len() <= self.len {
            self.items.push(item);
        }
        self.len += 1;
        while a > 0 {
            let parent = (a - 1) >> 1;
            if item.0 >= self.items[parent].0 {
                break;
            }
            self.items[a] = self.items[parent];
            a = parent;
        }
        self.items[a] = item;
    }

    fn poll(&mut self) -> Option<(f64, usize)> {
        if self.len == 0 {
            return None;
        }
        let top = self.items[0];
        self.len -= 1;
        self.items[0] = self.items[self.len];
        self.sift();
        Some(top)
    }

    fn sift(&mut self) {
        let o = self.len;
        let mut a = 0;
        let v = self.items[0];
        let mut c = 1;
        while c < o {
            let s = c + 1;
            a = c;
            if s < o && self.items[s].0 < self.items[c].0 {
                a = s;
            }
            self.items[(a - 1) >> 1] = self.items[a];
            c = 1 + (a << 1);
        }
        while a > 0 {
            let f = (a - 1) >> 1;
            if v.0 >= self.items[f].0 {
                break;
            }
            self.items[a] = self.items[f];
            a = f;
        }
        self.items[a] = v;
    }
}
