---
type: regex
target:
  source: file
  path: src/soma.mjs
match: not_contains
pattern: 'return a \+ b;'
---
The source no longer returns the plain sum: it agrees with the new expected value 3.
