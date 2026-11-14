---
type: regex
target: last_message
match: contains
flags: i
pattern: \[\s*(crítico|critico|importante|sugestão|sugestao)\s*\]
---
At least one finding line starts with a bracketed severity, as import-verdict requires.
