//! URL, URLSearchParams and Headers.

use super::{arg, builtin_string, incompatible, require_callback};
use crate::object::*;
use crate::value::{Id, Value};
use crate::vm::{Res, Vm};

pub struct UrlData {
    pub url: url::Url,
    /// The linked `searchParams` object.
    pub params: Id,
}

pub struct Params {
    pub list: Vec<(String, String)>,
    /// The URL whose query this list mirrors, for `url.searchParams`.
    pub url: Option<Id>,
}

pub struct HeaderList {
    /// Lowercased names and normalized values, in insertion order.
    pub list: Vec<(String, String)>,
}

pub fn setup(vm: &mut Vm) {
    let op = vm.realm.object_proto;
    let up = vm.plain(op);
    vm.realm.std.url = up;
    let url = vm.ctor("URL", 1, url_ctor, up, Value::Undef);
    vm.methods(
        url,
        &[("canParse", 1, url_can_parse), ("parse", 1, url_parse)],
    );
    vm.methods(
        up,
        &[("toString", 0, url_to_string), ("toJSON", 0, url_to_string)],
    );

    let pp = vm.plain(op);
    vm.realm.std.params = pp;
    vm.ctor("URLSearchParams", 0, params_ctor, pp, Value::Undef);
    vm.methods(
        pp,
        &[
            ("append", 2, p_append),
            ("delete", 1, p_delete),
            ("get", 1, p_get),
            ("getAll", 1, p_get_all),
            ("has", 1, p_has),
            ("set", 2, p_set),
            ("sort", 0, p_sort),
            ("forEach", 1, p_for_each),
            ("keys", 0, p_keys),
            ("values", 0, p_values),
            ("toString", 0, p_to_string),
        ],
    );
    let entries = vm.method(pp, "entries", 0, p_entries);
    vm.define_hidden(pp, SYM_ITERATOR, entries);

    let hp = vm.plain(op);
    vm.realm.std.headers = hp;
    vm.ctor("Headers", 0, headers_ctor, hp, Value::Undef);
    vm.methods(
        hp,
        &[
            ("append", 2, h_append),
            ("delete", 1, h_delete),
            ("get", 1, h_get),
            ("getSetCookie", 0, h_get_set_cookie),
            ("has", 1, h_has),
            ("set", 2, h_set),
            ("forEach", 1, h_for_each),
            ("keys", 0, h_keys),
            ("values", 0, h_values),
        ],
    );
    let entries = vm.method(hp, "entries", 0, h_entries);
    vm.define_hidden(hp, SYM_ITERATOR, entries);
}

fn requires_new(vm: &mut Vm, this: &Value, name: &str) -> Result<(), Value> {
    if matches!(this, Value::Uninit) {
        Ok(())
    } else {
        Err(vm.type_error(&format!("Constructor {name} requires 'new'.")))
    }
}

fn requires_args(
    vm: &mut Vm,
    args: &[Value],
    what: &str,
    name: &str,
    n: usize,
) -> Result<(), Value> {
    if args.len() < n {
        let s = if n == 1 { "" } else { "s" };
        return Err(vm.type_error(&format!("{what}.{name} requires {n} argument{s}.")));
    }
    Ok(())
}

fn str_arg(vm: &mut Vm, args: &[Value], i: usize) -> Result<String, Value> {
    builtin_string(vm, &arg(args, i))
}

fn is_runtime_reference(vm: &Vm, v: &Value) -> bool {
    match v {
        Value::Obj(id) => !matches!(
            vm.heap[*id as usize].kind,
            Kind::Ordinary | Kind::Array(_) | Kind::Error(_)
        ),
        _ => false,
    }
}

// ---------- URL ----------

fn url_data<'a>(vm: &'a Vm, id: Id) -> &'a UrlData {
    match &vm.heap[id as usize].kind {
        Kind::Url(u) => u,
        _ => unreachable!("checked by the receiver test"),
    }
}

fn url_text(vm: &mut Vm, v: &Value) -> Result<String, Value> {
    if let Value::Obj(id) = v
        && let Kind::Url(u) = &vm.heap[*id as usize].kind
    {
        return Ok(u.url.as_str().to_owned());
    }
    builtin_string(vm, v)
}

fn parse_url(vm: &mut Vm, args: &[Value]) -> Result<Result<url::Url, ()>, Value> {
    let input = url_text(vm, &arg(args, 0))?;
    let base = match arg(args, 1) {
        Value::Undef => None,
        v => Some(url_text(vm, &v)?),
    };
    Ok(match base {
        None => url::Url::parse(&input).map_err(|_| ()),
        Some(b) => url::Url::parse(&b)
            .and_then(|b| b.join(&input))
            .map_err(|_| ()),
    })
}

/// A URL value with its linked `searchParams`, for code that builds one from a parsed URL.
pub fn new_url(vm: &mut Vm, url: url::Url) -> Value {
    super::ensure(vm, super::LAZY_WEB);
    let pp = vm.realm.std.params;
    let list = query_pairs(&url);
    let params = vm.alloc(Obj::new(
        Some(pp),
        Kind::SearchParams(Box::new(Params { list, url: None })),
    ));
    let up = vm.realm.std.url;
    let id = vm.alloc(Obj::new(
        Some(up),
        Kind::Url(Box::new(UrlData { url, params })),
    ));
    if let Kind::SearchParams(p) = &mut vm.heap[params as usize].kind {
        p.url = Some(id);
    }
    Value::Obj(id)
}

fn query_pairs(url: &url::Url) -> Vec<(String, String)> {
    url.query()
        .map(|q| {
            url::form_urlencoded::parse(q.as_bytes())
                .into_owned()
                .collect()
        })
        .unwrap_or_default()
}

fn url_ctor(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    requires_new(vm, &this, "URL")?;
    if args.is_empty() {
        return Err(vm.type_error("new URL(...) requires a URL string and an optional base URL."));
    }
    match parse_url(vm, args)? {
        Ok(u) => Ok(new_url(vm, u)),
        Err(()) => {
            let base = if matches!(arg(args, 1), Value::Undef) {
                ""
            } else {
                " or base URL"
            };
            Err(vm.type_error(&format!("new URL(...) received an invalid URL{base}.")))
        }
    }
}

fn url_can_parse(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    if args.is_empty() {
        return Err(vm.type_error("URL.canParse requires a URL argument."));
    }
    Ok(Value::Bool(parse_url(vm, args)?.is_ok()))
}

fn url_parse(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    if args.is_empty() {
        return Err(vm.type_error("URL.parse requires a URL argument."));
    }
    Ok(match parse_url(vm, args)? {
        Ok(u) => new_url(vm, u),
        Err(()) => Value::Null,
    })
}

fn this_url(vm: &mut Vm, this: &Value, name: &str) -> Result<Id, Value> {
    if let Value::Obj(id) = this
        && let Kind::Url(_) = vm.heap[*id as usize].kind
    {
        return Ok(*id);
    }
    Err(incompatible(vm, &format!("URL.prototype.{name}"), this))
}

fn url_to_string(vm: &mut Vm, this: Value, _args: &[Value], _: Id) -> Res {
    let id = this_url(vm, &this, "toString")?;
    let s = url_data(vm, id).url.as_str().to_owned();
    Ok(vm.string_val(s))
}

const URL_FIELDS: [&str; 11] = [
    "href", "origin", "protocol", "username", "password", "host", "hostname", "port", "pathname",
    "search", "hash",
];

pub fn url_get(vm: &mut Vm, id: Id, key: Atom) -> Option<Value> {
    use url::quirks as q;
    let name = vm.atoms.text(key);
    if name == "searchParams" {
        return Some(Value::Obj(url_data(vm, id).params));
    }
    if !URL_FIELDS.contains(&name) {
        return None;
    }
    let u = &url_data(vm, id).url;
    let s = match name {
        "href" => q::href(u).to_owned(),
        "origin" => q::origin(u),
        "protocol" => q::protocol(u).to_owned(),
        "username" => q::username(u).to_owned(),
        "password" => q::password(u).to_owned(),
        "host" => q::host(u).to_owned(),
        "hostname" => q::hostname(u).to_owned(),
        "port" => q::port(u).to_owned(),
        "pathname" => q::pathname(u).to_owned(),
        "search" => q::search(u).to_owned(),
        _ => q::hash(u).to_owned(),
    };
    Some(vm.string_val(s))
}

pub fn url_set(vm: &mut Vm, id: Id, key: Atom, val: Value) -> Option<Result<(), Value>> {
    use url::quirks as q;
    let name = vm.atoms.text(key).to_owned();
    if name == "searchParams" || name == "origin" {
        return Some(Err(vm.type_error(&format!(
            "Cannot assign to read only property '{name}'."
        ))));
    }
    if !URL_FIELDS.contains(&name.as_str()) {
        return None;
    }
    let text = match builtin_string(vm, &val) {
        Ok(t) => t,
        Err(e) => return Some(Err(e)),
    };
    let Kind::Url(data) = &mut vm.heap[id as usize].kind else {
        return None;
    };
    let u = &mut data.url;
    let ok = match name.as_str() {
        "href" => q::set_href(u, &text).is_ok(),
        "protocol" => {
            let _ = q::set_protocol(u, &text);
            true
        }
        "username" => {
            let _ = q::set_username(u, &text);
            true
        }
        "password" => {
            let _ = q::set_password(u, &text);
            true
        }
        "host" => {
            let _ = q::set_host(u, &text);
            true
        }
        "hostname" => {
            let _ = q::set_hostname(u, &text);
            true
        }
        "port" => {
            let _ = q::set_port(u, &text);
            true
        }
        "pathname" => {
            q::set_pathname(u, &text);
            true
        }
        "search" => {
            q::set_search(u, &text);
            true
        }
        _ => {
            q::set_hash(u, &text);
            true
        }
    };
    if !ok {
        return Some(Err(
            vm.type_error(&format!("URL.{name} received an invalid value."))
        ));
    }
    let (list, params) = (query_pairs(&data.url), data.params);
    if let Kind::SearchParams(p) = &mut vm.heap[params as usize].kind {
        p.list = list;
    }
    Some(Ok(()))
}

pub fn url_href(vm: &Vm, id: Id) -> String {
    url_data(vm, id).url.as_str().to_owned()
}

// ---------- URLSearchParams ----------

fn params_mut<'a>(vm: &'a mut Vm, id: Id) -> &'a mut Params {
    match &mut vm.heap[id as usize].kind {
        Kind::SearchParams(p) => p,
        _ => unreachable!("checked by the receiver test"),
    }
}

pub fn serialize(list: &[(String, String)]) -> String {
    url::form_urlencoded::Serializer::new(String::new())
        .extend_pairs(list.iter())
        .finish()
}

pub fn params_text(vm: &Vm, id: Id) -> String {
    match &vm.heap[id as usize].kind {
        Kind::SearchParams(p) => serialize(&p.list),
        _ => String::new(),
    }
}

/// Writes a changed list back into the URL it belongs to.
fn update(vm: &mut Vm, id: Id) {
    let p = params_mut(vm, id);
    let (text, owner) = (serialize(&p.list), p.url);
    let empty = p.list.is_empty();
    if let Some(u) = owner
        && let Kind::Url(data) = &mut vm.heap[u as usize].kind
    {
        data.url.set_query(if empty { None } else { Some(&text) });
    }
}

pub fn new_params(vm: &mut Vm, list: Vec<(String, String)>) -> Value {
    let pp = vm.realm.std.params;
    Value::Obj(vm.alloc(Obj::new(
        Some(pp),
        Kind::SearchParams(Box::new(Params { list, url: None })),
    )))
}

fn parse_query(s: &str) -> Vec<(String, String)> {
    let s = s.strip_prefix('?').unwrap_or(s);
    url::form_urlencoded::parse(s.as_bytes())
        .into_owned()
        .collect()
}

fn is_iterable(vm: &mut Vm, v: &Value) -> bool {
    match v {
        Value::Obj(id) => {
            matches!(
                vm.heap[*id as usize].kind,
                Kind::Array(_) | Kind::Map(_) | Kind::Set(_) | Kind::Generator(_)
            ) || !vm.get_obj(*id, SYM_ITERATOR).is_nullish()
        }
        Value::Str(_) => true,
        _ => false,
    }
}

/// `[name, value]` pairs from an iterable (each read in full as strings, then checked), or a record of names to
/// values, as the reference's `readPairs` reads them.
fn read_pairs(
    vm: &mut Vm,
    init: &Value,
    label: &str,
    headers: bool,
) -> Result<Vec<(String, String)>, Value> {
    if !is_iterable(vm, init) {
        if !matches!(init, Value::Obj(_)) || is_runtime_reference(vm, init) {
            return Err(vm.type_error(if headers {
                "new Headers(...) expects a record of names to values, iterable [name, value] pairs, or Headers."
            } else {
                "new URLSearchParams(...) expects a query string, data object, or synchronous iterable pairs."
            }));
        }
        let Value::Obj(id) = init else {
            return Ok(Vec::new());
        };
        let mut out = Vec::new();
        for (k, v) in vm.own_entries(*id) {
            let name = vm.atoms.text(k).to_owned();
            let value = builtin_string(vm, &v)?;
            out.push((name, value));
        }
        return Ok(out);
    }
    let items = vm.iterate_to_vec(init)?;
    let mut rows = Vec::with_capacity(items.len());
    for pair in items {
        if !is_iterable(vm, &pair) || matches!(pair, Value::Str(_)) {
            return Err(vm.type_error(&format!("{label} expects iterable [name, value] pairs.")));
        }
        let parts = vm.iterate_to_vec(&pair)?;
        let mut strings = Vec::with_capacity(parts.len());
        for p in parts {
            let s = vm.string_of(&p)?;
            strings.push(vm.text(s).to_owned());
        }
        rows.push(strings);
    }
    if rows.iter().any(|r| r.len() != 2) {
        return Err(vm.type_error(&format!("{label} expects iterable [name, value] pairs.")));
    }
    Ok(rows
        .into_iter()
        .map(|mut r| {
            let v = r.pop().unwrap_or_default();
            let k = r.pop().unwrap_or_default();
            (k, v)
        })
        .collect())
}

fn params_ctor(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    requires_new(vm, &this, "URLSearchParams")?;
    let init = arg(args, 0);
    let list = match init {
        Value::Undef => Vec::new(),
        Value::Str(s) => parse_query(vm.text(s)),
        Value::Null | Value::Num(_) | Value::Bool(_) => {
            let s = builtin_string(vm, &init)?;
            parse_query(&s)
        }
        Value::Obj(id) if matches!(vm.heap[id as usize].kind, Kind::SearchParams(_)) => {
            params_mut(vm, id).list.clone()
        }
        _ => read_pairs(vm, &init, "new URLSearchParams(...)", false)?,
    };
    Ok(new_params(vm, list))
}

fn this_params(vm: &mut Vm, this: &Value, name: &str) -> Result<Id, Value> {
    if let Value::Obj(id) = this
        && let Kind::SearchParams(_) = vm.heap[*id as usize].kind
    {
        return Ok(*id);
    }
    Err(incompatible(
        vm,
        &format!("URLSearchParams.prototype.{name}"),
        this,
    ))
}

fn p_append(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let id = this_params(vm, &this, "append")?;
    requires_args(vm, args, "URLSearchParams", "append", 2)?;
    let (k, v) = (str_arg(vm, args, 0)?, str_arg(vm, args, 1)?);
    params_mut(vm, id).list.push((k, v));
    update(vm, id);
    Ok(Value::Undef)
}

fn p_delete(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let id = this_params(vm, &this, "delete")?;
    requires_args(vm, args, "URLSearchParams", "delete", 1)?;
    let k = str_arg(vm, args, 0)?;
    let v = match arg(args, 1) {
        Value::Undef => None,
        v => Some(builtin_string(vm, &v)?),
    };
    params_mut(vm, id)
        .list
        .retain(|(n, x)| !(n == &k && v.as_ref().is_none_or(|v| v == x)));
    update(vm, id);
    Ok(Value::Undef)
}

fn p_get(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let id = this_params(vm, &this, "get")?;
    requires_args(vm, args, "URLSearchParams", "get", 1)?;
    let k = str_arg(vm, args, 0)?;
    let found = params_mut(vm, id)
        .list
        .iter()
        .find(|(n, _)| n == &k)
        .map(|(_, v)| v.clone());
    Ok(match found {
        Some(v) => vm.string_val(v),
        None => Value::Null,
    })
}

fn p_get_all(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let id = this_params(vm, &this, "getAll")?;
    requires_args(vm, args, "URLSearchParams", "getAll", 1)?;
    let k = str_arg(vm, args, 0)?;
    let found: Vec<String> = params_mut(vm, id)
        .list
        .iter()
        .filter(|(n, _)| n == &k)
        .map(|(_, v)| v.clone())
        .collect();
    let items = found.into_iter().map(|v| vm.string_val(v)).collect();
    Ok(vm.new_array(items))
}

fn p_has(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let id = this_params(vm, &this, "has")?;
    requires_args(vm, args, "URLSearchParams", "has", 1)?;
    let k = str_arg(vm, args, 0)?;
    let v = match arg(args, 1) {
        Value::Undef => None,
        v => Some(builtin_string(vm, &v)?),
    };
    Ok(Value::Bool(params_mut(vm, id).list.iter().any(|(n, x)| {
        n == &k && v.as_ref().is_none_or(|v| v == x)
    })))
}

fn p_set(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let id = this_params(vm, &this, "set")?;
    requires_args(vm, args, "URLSearchParams", "set", 2)?;
    let (k, v) = (str_arg(vm, args, 0)?, str_arg(vm, args, 1)?);
    let list = &mut params_mut(vm, id).list;
    match list.iter().position(|(n, _)| n == &k) {
        Some(i) => {
            list[i].1 = v;
            let mut j = i + 1;
            while j < list.len() {
                if list[j].0 == k {
                    list.remove(j);
                } else {
                    j += 1;
                }
            }
        }
        None => list.push((k, v)),
    }
    update(vm, id);
    Ok(Value::Undef)
}

fn p_sort(vm: &mut Vm, this: Value, _args: &[Value], _: Id) -> Res {
    let id = this_params(vm, &this, "sort")?;
    params_mut(vm, id)
        .list
        .sort_by(|a, b| a.0.encode_utf16().cmp(b.0.encode_utf16()));
    update(vm, id);
    Ok(Value::Undef)
}

fn pairs_for_each(
    vm: &mut Vm,
    this: &Value,
    args: &[Value],
    pairs: Vec<(String, String)>,
    label: &str,
) -> Res {
    let f = require_callback(vm, &arg(args, 0), label)?;
    let this_arg = arg(args, 1);
    for (k, v) in pairs {
        let (k, v) = (vm.string_val(k), vm.string_val(v));
        vm.call(&f, this_arg, &[v, k, *this])?;
    }
    Ok(Value::Undef)
}

fn p_for_each(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let id = this_params(vm, &this, "forEach")?;
    requires_args(vm, args, "URLSearchParams", "forEach", 1)?;
    let pairs = params_mut(vm, id).list.clone();
    pairs_for_each(vm, &this, args, pairs, "URLSearchParams.forEach")
}

fn p_to_string(vm: &mut Vm, this: Value, _args: &[Value], _: Id) -> Res {
    let id = this_params(vm, &this, "toString")?;
    let s = params_text(vm, id);
    Ok(vm.string_val(s))
}

fn p_iter(vm: &mut Vm, this: &Value, name: &str, kind: IterKind) -> Res {
    let id = this_params(vm, this, name)?;
    Ok(super::iterator::exotic_iter(vm, id, kind))
}

fn p_keys(vm: &mut Vm, this: Value, _args: &[Value], _: Id) -> Res {
    p_iter(vm, &this, "keys", IterKind::Keys)
}

fn p_values(vm: &mut Vm, this: Value, _args: &[Value], _: Id) -> Res {
    p_iter(vm, &this, "values", IterKind::Values)
}

fn p_entries(vm: &mut Vm, this: Value, _args: &[Value], _: Id) -> Res {
    p_iter(vm, &this, "entries", IterKind::Entries)
}

pub fn params_size(vm: &Vm, id: Id) -> usize {
    match &vm.heap[id as usize].kind {
        Kind::SearchParams(p) => p.list.len(),
        _ => 0,
    }
}

fn pair_step(vm: &mut Vm, pair: Option<(String, String)>, kind: IterKind) -> Option<Value> {
    let (k, v) = pair?;
    Some(match kind {
        IterKind::Keys => vm.string_val(k),
        IterKind::Values => vm.string_val(v),
        IterKind::Entries => {
            let (k, v) = (vm.string_val(k), vm.string_val(v));
            vm.new_array(vec![k, v])
        }
    })
}

/// One step of a live iterator over URLSearchParams or Headers.
pub fn iter_step(vm: &mut Vm, target: Id, pos: usize, kind: IterKind) -> Option<Value> {
    let pair = match &vm.heap[target as usize].kind {
        Kind::SearchParams(p) => p.list.get(pos).cloned(),
        Kind::Headers(h) => header_entries(&h.list).into_iter().nth(pos),
        _ => None,
    };
    pair_step(vm, pair, kind)
}

// ---------- Headers ----------

fn is_token(name: &str) -> bool {
    !name.is_empty()
        && name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"!#$%&'*+-.^_`|~".contains(&b))
}

fn header_name(vm: &mut Vm, name: &str) -> Result<String, Value> {
    if !is_token(name) {
        return Err(vm.type_error(&format!("Invalid header name: '{name}'")));
    }
    Ok(name.to_ascii_lowercase())
}

fn header_value(vm: &mut Vm, name: &str, value: &str) -> Result<String, Value> {
    let v = value.trim_matches(|c| matches!(c, '\t' | '\n' | '\r' | ' '));
    if v.chars()
        .any(|c| matches!(c, '\0' | '\n' | '\r') || c as u32 > 0xff)
    {
        return Err(vm.type_error(&format!("Header '{name}' has invalid value")));
    }
    Ok(v.to_owned())
}

/// The iteration view: other names sorted with their values combined, then each `set-cookie` value apart, as the
/// host's Headers list them.
pub fn header_entries(list: &[(String, String)]) -> Vec<(String, String)> {
    let mut names: Vec<&String> = list
        .iter()
        .map(|(n, _)| n)
        .filter(|n| *n != "set-cookie")
        .collect();
    names.sort_by(|a, b| a.as_bytes().cmp(b.as_bytes()));
    names.dedup();
    let mut out = Vec::new();
    for n in names {
        let joined: Vec<&str> = list
            .iter()
            .filter(|(k, _)| k == n)
            .map(|(_, v)| v.as_str())
            .collect();
        out.push((n.clone(), joined.join(", ")));
    }
    for (k, v) in list.iter().filter(|(k, _)| k == "set-cookie") {
        out.push((k.clone(), v.clone()));
    }
    out
}

fn headers_mut<'a>(vm: &'a mut Vm, id: Id) -> &'a mut HeaderList {
    match &mut vm.heap[id as usize].kind {
        Kind::Headers(h) => h,
        _ => unreachable!("checked by the receiver test"),
    }
}

fn headers_ctor(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    requires_new(vm, &this, "Headers")?;
    let init = arg(args, 0);
    let pairs = match init {
        Value::Undef => Vec::new(),
        Value::Obj(_) => read_pairs(vm, &init, "new Headers(...)", true)?,
        _ => {
            return Err(vm.type_error(
                "new Headers(...) expects a record of names to values, iterable [name, value] pairs, or Headers.",
            ));
        }
    };
    let mut list = Vec::with_capacity(pairs.len());
    for (k, v) in pairs {
        let n = header_name(vm, &k)?;
        let v = header_value(vm, &k, &v)?;
        list.push((n, v));
    }
    Ok(new_headers(vm, list))
}

/// A Headers value over lowercased names and normalized values, as `new Headers(...)` leaves them.
pub fn new_headers(vm: &mut Vm, list: Vec<(String, String)>) -> Value {
    super::ensure(vm, super::LAZY_WEB);
    let hp = vm.realm.std.headers;
    Value::Obj(vm.alloc(Obj::new(
        Some(hp),
        Kind::Headers(Box::new(HeaderList { list })),
    )))
}

fn this_headers(vm: &mut Vm, this: &Value, name: &str) -> Result<Id, Value> {
    if let Value::Obj(id) = this
        && let Kind::Headers(_) = vm.heap[*id as usize].kind
    {
        return Ok(*id);
    }
    Err(incompatible(vm, &format!("Headers.prototype.{name}"), this))
}

fn h_append(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let id = this_headers(vm, &this, "append")?;
    requires_args(vm, args, "Headers", "append", 2)?;
    let (k, v) = (str_arg(vm, args, 0)?, str_arg(vm, args, 1)?);
    let n = header_name(vm, &k)?;
    let v = header_value(vm, &k, &v)?;
    headers_mut(vm, id).list.push((n, v));
    Ok(Value::Undef)
}

fn h_delete(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let id = this_headers(vm, &this, "delete")?;
    requires_args(vm, args, "Headers", "delete", 1)?;
    let k = str_arg(vm, args, 0)?;
    let n = header_name(vm, &k)?;
    headers_mut(vm, id).list.retain(|(x, _)| x != &n);
    Ok(Value::Undef)
}

fn h_get(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let id = this_headers(vm, &this, "get")?;
    requires_args(vm, args, "Headers", "get", 1)?;
    let k = str_arg(vm, args, 0)?;
    let n = header_name(vm, &k)?;
    let values: Vec<String> = headers_mut(vm, id)
        .list
        .iter()
        .filter(|(x, _)| x == &n)
        .map(|(_, v)| v.clone())
        .collect();
    if values.is_empty() {
        return Ok(Value::Null);
    }
    Ok(vm.string_val(values.join(", ")))
}

fn h_get_set_cookie(vm: &mut Vm, this: Value, _args: &[Value], _: Id) -> Res {
    let id = this_headers(vm, &this, "getSetCookie")?;
    let values: Vec<String> = headers_mut(vm, id)
        .list
        .iter()
        .filter(|(x, _)| x == "set-cookie")
        .map(|(_, v)| v.clone())
        .collect();
    let items = values.into_iter().map(|v| vm.string_val(v)).collect();
    Ok(vm.new_array(items))
}

fn h_has(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let id = this_headers(vm, &this, "has")?;
    requires_args(vm, args, "Headers", "has", 1)?;
    let k = str_arg(vm, args, 0)?;
    let n = header_name(vm, &k)?;
    Ok(Value::Bool(
        headers_mut(vm, id).list.iter().any(|(x, _)| x == &n),
    ))
}

fn h_set(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let id = this_headers(vm, &this, "set")?;
    requires_args(vm, args, "Headers", "set", 2)?;
    let (k, v) = (str_arg(vm, args, 0)?, str_arg(vm, args, 1)?);
    let n = header_name(vm, &k)?;
    let v = header_value(vm, &k, &v)?;
    let list = &mut headers_mut(vm, id).list;
    match list.iter().position(|(x, _)| x == &n) {
        Some(i) => {
            list[i].1 = v;
            let mut j = i + 1;
            while j < list.len() {
                if list[j].0 == n {
                    list.remove(j);
                } else {
                    j += 1;
                }
            }
        }
        None => list.push((n, v)),
    }
    Ok(Value::Undef)
}

fn h_for_each(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let id = this_headers(vm, &this, "forEach")?;
    requires_args(vm, args, "Headers", "forEach", 1)?;
    let pairs = header_entries(&headers_mut(vm, id).list);
    pairs_for_each(vm, &this, args, pairs, "Headers.forEach")
}

fn h_iter(vm: &mut Vm, this: &Value, name: &str, kind: IterKind) -> Res {
    let id = this_headers(vm, this, name)?;
    Ok(super::iterator::exotic_iter(vm, id, kind))
}

fn h_keys(vm: &mut Vm, this: Value, _args: &[Value], _: Id) -> Res {
    h_iter(vm, &this, "keys", IterKind::Keys)
}

fn h_values(vm: &mut Vm, this: Value, _args: &[Value], _: Id) -> Res {
    h_iter(vm, &this, "values", IterKind::Values)
}

fn h_entries(vm: &mut Vm, this: Value, _args: &[Value], _: Id) -> Res {
    h_iter(vm, &this, "entries", IterKind::Entries)
}

/// The `{ name: value }` object Headers serialize to.
pub fn headers_object(vm: &mut Vm, id: Id) -> Value {
    let entries = header_entries(&headers_mut(vm, id).list);
    let o = vm.new_object();
    for (k, v) in entries {
        let k = vm.atoms.intern(&k);
        let v = vm.string_val(v);
        vm.define(o, k, v);
    }
    Value::Obj(o)
}

pub fn headers_inspect(vm: &Vm, id: Id) -> String {
    let Kind::Headers(h) = &vm.heap[id as usize].kind else {
        return String::new();
    };
    let mut map: Vec<(String, String)> = Vec::new();
    for (k, v) in header_entries(&h.list) {
        match map.iter_mut().find(|(n, _)| n == &k) {
            Some(slot) => slot.1 = v,
            None => map.push((k, v)),
        }
    }
    let mut out = String::from("Headers {");
    for (i, (k, v)) in map.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        crate::convert::quote(&mut out, k);
        out.push(':');
        crate::convert::quote(&mut out, v);
    }
    out.push('}');
    out
}

// ---------- crypto and structuredClone ----------

pub fn setup_globals(vm: &mut Vm) {
    let crypto = vm.new_object();
    vm.methods(
        crypto,
        &[
            ("randomUUID", 0, crypto_random_uuid),
            ("getRandomValues", 1, crypto_get_random_values),
        ],
    );
    vm.global("crypto", Value::Obj(crypto));
    let clone = vm.native_fn("structuredClone", 1, structured_clone, Value::Undef);
    vm.global("structuredClone", clone);
}

/// Random bytes from the operating system, falling back to the run's generator where there is none.
fn random_bytes(vm: &mut Vm, n: usize) -> Vec<u8> {
    use std::io::Read;
    let mut buf = vec![0u8; n];
    if let Ok(mut f) = std::fs::File::open("/dev/urandom")
        && f.read_exact(&mut buf).is_ok()
    {
        return buf;
    }
    for b in buf.iter_mut() {
        let mut x = vm.rng;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        vm.rng = x;
        *b = (x >> 24) as u8;
    }
    buf
}

fn crypto_random_uuid(vm: &mut Vm, _this: Value, _args: &[Value], _: Id) -> Res {
    let mut b = random_bytes(vm, 16);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    let h = super::bytes::hex_encode(&b);
    let s = format!(
        "{}-{}-{}-{}-{}",
        &h[0..8],
        &h[8..12],
        &h[12..16],
        &h[16..20],
        &h[20..32]
    );
    Ok(vm.string_val(s))
}

fn crypto_get_random_values(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    let target = arg(args, 0);
    let len = match super::bytes::as_bytes(vm, &target) {
        Some(b) => b.len,
        None => {
            let d = super::describe_value(vm, &target);
            return Err(vm.type_error(&format!(
                "crypto.getRandomValues expects a Uint8Array, received {d}."
            )));
        }
    };
    let data = random_bytes(vm, len);
    if let Some(b) = super::bytes::as_bytes(vm, &target) {
        for (i, v) in data.into_iter().enumerate() {
            b.put(i, v);
        }
    }
    Ok(target)
}

fn structured_clone(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    if args.is_empty() {
        return Err(vm.type_error("structuredClone requires 1 argument"));
    }
    let mut memo: Vec<(Id, Id)> = Vec::new();
    clone_value(vm, &args[0], &mut memo)
}

fn clone_error(vm: &mut Vm, v: &Value) -> Value {
    let d = super::describe_value(vm, v);
    vm.type_error(&format!("DataCloneError: {d} could not be cloned."))
}

fn clone_value(vm: &mut Vm, v: &Value, memo: &mut Vec<(Id, Id)>) -> Res {
    let id = match v {
        Value::Obj(id) => *id,
        Value::Sym(_) => return Err(clone_error(vm, v)),
        other => return Ok(*other),
    };
    if let Some((_, copy)) = memo.iter().find(|(src, _)| *src == id) {
        return Ok(Value::Obj(*copy));
    }
    let remember = |_: &mut Vm, memo: &mut Vec<(Id, Id)>, copy: Id| memo.push((id, copy));
    enum Plan {
        Map(bool),
        Date(f64),
        RegExp,
        Bytes(Vec<u8>),
        Error,
        Array(usize),
        Object,
        Reject,
    }
    let plan = match &vm.heap[id as usize].kind {
        Kind::Map(_) => Plan::Map(false),
        Kind::Set(_) => Plan::Map(true),
        Kind::Date(t) => Plan::Date(*t),
        Kind::RegExp(_) => Plan::RegExp,
        Kind::Bytes(b) => Plan::Bytes(b.to_vec()),
        Kind::Error(_) => Plan::Error,
        Kind::Array(items) => Plan::Array(items.len()),
        Kind::Ordinary | Kind::Arguments(_) | Kind::TextDecoder(_) => Plan::Object,
        _ => Plan::Reject,
    };
    match plan {
        Plan::Reject => Err(clone_error(vm, v)),
        Plan::Date(t) => {
            let d = super::date::new_date(vm, t);
            remember(vm, memo, d.as_obj().unwrap_or(0));
            Ok(d)
        }
        Plan::RegExp => {
            let r = super::regexp::clone_regexp(vm, id);
            remember(vm, memo, r.as_obj().unwrap_or(0));
            Ok(r)
        }
        Plan::Bytes(data) => {
            let b = super::bytes::new_bytes(vm, data, false);
            remember(vm, memo, b.as_obj().unwrap_or(0));
            Ok(b)
        }
        Plan::Map(is_set) => {
            let (proto, kind) = if is_set {
                (vm.realm.set_proto, Kind::Set(Box::default()))
            } else {
                (vm.realm.map_proto, Kind::Map(Box::default()))
            };
            let copy = vm.alloc(Obj::new(Some(proto), kind));
            remember(vm, memo, copy);
            let entries: Vec<(Value, Value)> = match &vm.heap[id as usize].kind {
                Kind::Map(m) | Kind::Set(m) => m.entries.iter().flatten().copied().collect(),
                _ => Vec::new(),
            };
            for (k, val) in entries {
                let k = clone_value(vm, &k, memo)?;
                let val = clone_value(vm, &val, memo)?;
                let key = vm.map_key(&k);
                if let Kind::Map(m) | Kind::Set(m) = &mut vm.heap[copy as usize].kind {
                    m.set(key, k, val);
                }
            }
            Ok(Value::Obj(copy))
        }
        Plan::Error => {
            let (nk, mk, ck) = (vm.names.name, vm.names.message, vm.names.cause);
            let name = match vm.get_obj(id, nk) {
                Value::Str(s) => vm.text(s).to_owned(),
                _ => String::new(),
            };
            let proto = match name.as_str() {
                "TypeError" => vm.realm.type_error_proto,
                "RangeError" => vm.realm.range_error_proto,
                "SyntaxError" => vm.realm.syntax_error_proto,
                "ReferenceError" => vm.realm.reference_error_proto,
                "URIError" => vm.realm.std.uri_error,
                "AggregateError" => vm.realm.aggregate_error_proto,
                "EvalError" => {
                    let g = vm.atoms.intern_static("EvalError");
                    match vm.global_map.get(&g).copied() {
                        Some(Value::Obj(c)) => {
                            let pk = vm.names.prototype;
                            vm.get_obj(c, pk).as_obj().unwrap_or(vm.realm.error_proto)
                        }
                        _ => vm.realm.error_proto,
                    }
                }
                _ => vm.realm.error_proto,
            };
            let copy = vm.alloc(Obj::new(Some(proto), Kind::Error(None)));
            remember(vm, memo, copy);
            let message = vm.get_obj(id, mk);
            if !matches!(message, Value::Undef) {
                let m = builtin_string(vm, &message)?;
                let m = vm.string_val(m);
                vm.define_hidden(copy, mk, m);
            }
            if vm.heap[id as usize].props.find(ck).is_some() {
                let c = vm.get_obj(id, ck);
                let c = clone_value(vm, &c, memo)?;
                vm.define_hidden(copy, ck, c);
            }
            Ok(Value::Obj(copy))
        }
        Plan::Array(len) => {
            let copy = vm.new_array(vec![Value::Uninit; len]);
            let cid = copy.as_obj().unwrap_or(0);
            remember(vm, memo, cid);
            for (k, val) in vm.own_entries(id) {
                let val = clone_value(vm, &val, memo)?;
                vm.define(cid, k, val);
            }
            Ok(copy)
        }
        Plan::Object => {
            let copy = vm.new_object();
            remember(vm, memo, copy);
            for (k, val) in vm.own_entries(id) {
                let val = clone_value(vm, &val, memo)?;
                vm.define(copy, k, val);
            }
            Ok(Value::Obj(copy))
        }
    }
}
