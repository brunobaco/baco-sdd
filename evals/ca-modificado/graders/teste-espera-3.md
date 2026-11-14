---
type: regex
target:
  source: file
  path: test/soma.test.mjs
match: contains
pattern: ',\s*3\s*\)'
---
The test file now expects the new value 3 for CA-TAR-001.
