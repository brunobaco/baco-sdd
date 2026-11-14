---
type: regex
target:
  source: file
  path: src/soma.mjs
match: contains
pattern: '(?:return\s+|=>\s*)(?:a\s*\+\s*b\s*\+\s*1|1\s*\+\s*a\s*\+\s*b|a\s*\+\s*1\s*\+\s*b|3)(?![\d.\w])'
---
The source really returns the new value: the sum plus the fixed adjustment of 1 (or the literal 3), so soma(1, 1) is 3. A respacing of `return a + b;`, an emptied file or a bare `return;` does not match.
