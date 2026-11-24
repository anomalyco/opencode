// Component tests navigate directly to an isolated story. Only the homepage loads the catalog and inspector.
if (new URLSearchParams(location.search).has("id")) {
  void import("./frame")
} else {
  void import("./lab")
}
