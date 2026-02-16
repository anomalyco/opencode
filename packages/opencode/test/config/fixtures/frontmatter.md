---
description: "This is a description wrapped in quotes"
# field: this is a commented out field that should be ignored
occupation: This man has the following occupation: Software Engineer
title: 'Hello World'
name: John "Doe"

family: He has no 'family'
summary: >
  This is a summary
url: https://example.com:8080/path?query=value
time: The time is 12:30:00 PM
nested: First: Second: Third: Fourth
quoted_colon: "Already quoted: no change needed"
single_quoted_colon: 'Single quoted: also fine'
mixed: He said "hello: world" and then left
empty:
dollar: Use $' and $& for special patterns
---

Content that should not be parsed:

fake_field: this is not yaml
another: neither is this
time: 10:30:00 AM
url: https://should-not-be-parsed.com:3000

The above lines look like YAML but are just content.
