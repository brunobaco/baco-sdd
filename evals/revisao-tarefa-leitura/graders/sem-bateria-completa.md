---
type: tool_used
tool: Bash
input_match: "run-tests[^\"]*--all"
min: 0
max: 0
arm: both
---
A task review never runs the whole suite (`run-tests --all`); that runs once when every task is merged.
