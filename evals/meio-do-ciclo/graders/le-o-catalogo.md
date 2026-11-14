---
type: llm
focus: trace
weight: 1
---
Before planning, the agent consulted the spec catalog to check that the spec is approved, by any means: a Read of docs/catalogo-de-specs.md, a shell reader such as `cat` on it, or the engine (`baco catalog get TAR` or `catalog list`). Failure: the trace shows no tool call that opened or queried the catalog (a mention of it inside the skill's own reference text does not count).
