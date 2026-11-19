// An uncaught instance of a class extending an Error type fails the run as that error does.
class E extends TypeError { name = "NotFound" }
throw new E("gone")
