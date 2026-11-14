---
type: llm
weight: 1
---
The project has an approved spec (TAR 1.0), an approved architecture (docs/arquitetura/README.md and ADR-001, status Aceita) and no .baco/config.yaml. The agent goes to planning the first delivery from that spec: it proposes the cut, the tasks or the level, and at most offers to create the configuration without making it a precondition. If git is unavailable in the session it may say so, but it still presents a planning proposal. Failure: it refuses to plan until the config, governance or product vision exist, it asks to redo the architecture or the spec first, or it restarts the project from the idea phase.
