if (location.pathname === "/loading") {
  void import("./loading")
} else {
  void import("./")
}
