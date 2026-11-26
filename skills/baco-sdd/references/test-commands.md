# Test commands: reports and machine settings

Load this reference when you set or check the project's test commands (`tests`, `tests_quick`, `app.smoke` in `.baco/config.yaml`): in phase 0 ([configure-questions.md](configure-questions.md), question 7), in phase 3 when the stack sets them ([architecture.md](architecture.md)) and in phase 6 when a command fails to report ([implementation.md](implementation.md)).

## Known gap: each command must write its own JUnit file

The engine reads every `*.xml` in `tests.junit_dir` (default `.baco/junit`). It does not turn the command's output into a report (`baco run-tests` only saves that output to `.baco/logs/` for reading). So each test command must itself write its JUnit XML into `.baco/junit/`, for example with an output-file flag or variable. A bare `--reporter=junit` often prints to the terminal and writes nothing.

Examples (verify against the project's tool and version before using):
- Vitest: `npx vitest run --reporter=junit --outputFile=.baco/junit/unit.xml`
- Node test runner: `node --test --test-reporter=junit --test-reporter-destination=.baco/junit/unit.xml`
- Playwright: `PLAYWRIGHT_JUNIT_OUTPUT_FILE=.baco/junit/e2e.xml npx playwright test --reporter=junit`
- Jest (with `jest-junit`): `JEST_JUNIT_OUTPUT_DIR=.baco/junit npx jest --reporters=jest-junit`

Verify, do not assume: with the user's consent, run each command once and check that a new `.xml` appeared under `.baco/junit/` and that it lists the tests. If it did not, fix the command (flag or variable) and run again. In a project with no code yet the command cannot run; it stays unverified until the plan's skeleton task proves it with a clean install ([planning.md](planning.md), section 4, "Skeleton task"). If the user declines to run it, write the command and tell them it is unverified:

> Ainda não conferi se esse comando gera o relatório de testes na pasta certa. Sem isso, a conferência dos critérios de aceite não enxerga os testes. Posso rodar uma vez para checar?

Test titles must carry the criterion ID (`[CA-…]` or `[CT-…]`); that matters in phase 6, not here.

## Machine settings: `.baco/local.env`

Things that differ per machine (for example `PLAYWRIGHT_BROWSERS_PATH`, a local database URL for tests) go in `.baco/local.env`, one `KEY=VALUE` per line. `baco run-tests` loads it before each command. It is never versioned: add `.baco/local.env` to `.gitignore` and create the file only when there is something to put in it. If a test command only works with a path or variable specific to this machine, put it here, not in the command.

## Parallel batteries and memory limits (OOM)

When multiple tasks run in parallel on a memory-constrained machine, running heavy test suites concurrently (for example two Vitest/Jest integration layers or two Playwright browser runs at once) can exhaust memory and get OOM-killed. To prevent this:
- Add every heavy test layer (not only `e2e`, also `integration` or bundler/database suites) to `tests.queue` in `.baco/config.yaml` so `baco run-tests` serializes them through the machine-wide queue.
- Cap runner worker counts in the test command (for example Playwright `--workers=1` or Vitest `--maxWorkers=2`).
- When running inside a sandbox that makes `/tmp` read-only, pass `BACO_QUEUE_DIR` to external implementers ([ambientes.md](ambientes.md), section 2) so all harnesses share one queue lock.
