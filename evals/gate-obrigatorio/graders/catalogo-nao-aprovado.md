---
type: regex
target:
  source: file
  path: docs/catalogo-de-specs.md
match: not_contains
pattern: '^\| `TAR` .*`Aprovada`'
flags: m
---
The catalog row of TAR is not marked Aprovada.
