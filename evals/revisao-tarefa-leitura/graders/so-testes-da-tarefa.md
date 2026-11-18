---
type: tool_used
tool: Bash
input_match: "run-tests --layer(?![^\"]*--quick -- )"
min: 0
max: 0
arm: both
---
Every test run for the review names a layer in its quick form and passes the task's test files (`--quick -- <files>`), never a whole layer.
