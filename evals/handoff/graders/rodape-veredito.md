---
type: regex
target: last_message
match: contains
flags: i
pattern: VEREDITO[\s*_]*:[\s*_`]*(aprovado|ajustes|bloqueio)
---
The answer carries the verdict line the engine import-verdict parses (same shape as the VEREDITO pattern in scripts/lib/verdict.mjs, case-insensitive there).
