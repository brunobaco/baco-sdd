---
type: regex
target: trace
match: contains
pattern: '"name":"(?:Read|Bash|Grep)","input":\{(?:"\w+":(?:"(?:[^"\\]|\\.)*"|[^,"{}]*),)*"\w+":"(?:[^"\\]|\\.)*?(?:catalogo-de-specs|catalog\s+(?:get|list)\b)'
---
Before planning, the agent consulted the spec catalog to check that the spec is approved, by any means: a Read of docs/catalogo-de-specs.md, a shell reader such as `cat`, `head` or `grep` on it, a Grep over it, or the engine (`baco catalog get TAR` or `catalog list`). The pattern only matches inside the input of a Read, Bash or Grep tool call, so the skill's own reference text (which also names the catalog) does not count. This is a regex over the raw trace and not an llm judge on purpose: the judge sees only the first 12 and the last 12 trace lines, and the catalog read usually falls in the elided middle.
