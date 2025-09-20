#!/usr/bin/env jq -rf

# This script simplifies the JSON emitted by `otel-cli` as follows:
#   - If possible, strings that look like they may contain JSON are replaced with actual JSON (recursively)
#   - Any object containing a single field named `Value` is replaced with whatever the actual value is
#   - Arrays of key/value pairs are replaced with an object (using `from_entries`)

# For the curious:
#
# The JSON emitted by the `otel-cli` tool is far more detailed than we need. It contains a lot of arrays
# similar to the following:
#   {
#     "attributes": [
#       {
#         "key": "exception.type",
#         "value": {
#           "Value": {
#             "StringValue": "AbortError"
#           }
#         }
#       },
#       #(...)
#     ]
#   }

# Walks all objects/arrays looking for strings that might contain JSON text.
# If any are found: it attempts to replace the text using `fromjson` (recursively),
# then falls back to the original string if that fails.
def replace_json_strings:
    if type == "object" then
        with_entries(.value |= replace_json_strings)
    elif type == "array" then
        map(replace_json_strings)
    elif type == "string" and test("^[\\[{]") then
        (fromjson | replace_json_strings) // .
    else
        .
    end;

# Walks all objects/arrays, applying a transformer to everything
def walk(f):
  if type == "object" then
    with_entries(.value |= walk(f)) | f
  elif type == "array" then
    map(walk(f)) | f
  else
    f
  end;

# - Replace `.Value` with the actual value in its child
# - Replace key/value pair arrays (ala `to_entries`) with an object using `from_entries`
def transform:
  if type == "object" and (keys | length == 1) and has("Value") then
    (.Value | if type == "object" then to_entries[0].value else . end)
  elif type == "array" and length > 0 and (.[0] | type == "object" and has("key") and has("value")) then
    from_entries
  else
    .
  end;

# Do it
replace_json_strings | walk(transform)
