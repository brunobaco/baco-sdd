---
type: llm
focus: trace
weight: 1
---
Read the review request `.baco/logs/pedido-revisao-T-002-01.md` as shown in the trace. Pass when the test results it gives come only from the task's tests (`tests/titulo.test.mjs` and `tests/tarefas.test.mjs`) run in quick form through `baco run-tests`, with the command and the exit code. Failure: the request reports a whole layer, the whole suite, `tests/e2e`, or a run without `--quick`, or has no test result at all.
