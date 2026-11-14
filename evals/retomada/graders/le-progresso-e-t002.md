---
type: llm
focus: trace
weight: 1
---
Before answering, the agent read the delivery progress file (progresso.md) and the T-002 task file from the project, by any means: the Read tool, a shell reader such as `cat`, or the engine. Reading only the plan or only the skill references is not enough. Failure: no tool call shows progresso.md and T-002.md being opened or printed.
