# Architecture discovery, code audit and safe transitions

Load this reference alongside [architecture.md](architecture.md) when working on an existing repository (`Validate` or `Revisit` with code), when running phase 3 in mode `Audit` (`auditar arquitetura`), or when planning a technical transition or performance improvement on a live system.

## 1. Discovering the real state of an existing repository

Never trust an old README, a folder name or a verbal description as proof of how the system runs. Before proposing or validating changes on a repository that already has code:

1. Anchor the snapshot: record the branch, the `HEAD` short sha and whether the working tree is clean.
2. Map what actually runs from the files: dependency manifests, build and CI configs, entrypoints, HTTP/RPC routes, background jobs and workers, databases, caches, queues and external integrations.
3. Map real module and layer boundaries from imports and wiring, not from directory names alone.
4. Compare the observed state with `docs/arquitetura/README.md` and the accepted ADRs. Label every statement honestly as `observado` (seen in code/config), `documentado` (written in docs only) or `não verificado`. List contradictions as architecture drift.

## 2. Mode Audit: read-only code architecture audit

Trigger: the person asks to audit the codebase architecture (`auditar arquitetura`), between deliveries or before a major evolution. Role: [architect](roles/architect.md) in read-only mode (writes only its report `.baco/logs/revisoes/arquitetura-auditoria-NN.md`; no code edits, no ADR edits, no gate).

### Materiality gate

Every finding must name concrete evidence (`file:line` or import path), a real consequence at the current or declared expected load (`docs/arquitetura/README.md`), and the smallest safe incremental step. Never report style taste, theoretical purity or speculative scale. If a pattern violates no accepted ADR and causes no real maintenance, integrity or performance cost, do not open a finding.

### What to inspect

1. **Boundary and drift checks:** imports that cross declared `allow`/`disallow` boundaries (for example UI importing database code directly), leaks into a module's private internals instead of its public entrypoint, or new external services/integrations with no ADR.
2. **Dependency cycles with impact:** cycles that tangle initialization, testing or deployment, or force unrelated changes together. A harmless cycle with no real consequence is not a finding.
3. **Module depth and coupling:** pass-through wrappers that add indirection without hiding complexity, volatile decisions duplicated across modules (files that always change together), and functions mixing unrelated jobs (split by job, never by line count).
4. **Data, transactions and failure boundaries:** database transactions held open across remote calls, read functions with hidden writes, derived data (cache, search index, projection) without an owner or rebuild rule, and external calls without explicit timeouts or idempotency on retry.
5. **Configuration boundary:** environment variables read directly across business modules instead of a single validated config boundary, or secrets leaking into logs or domain objects.
6. **Unfinished migrations:** two parallel paths left behind by a partial refactor or schema change with no clear end.
7. **Shortcut inventory (`shortcut:`):** scan the repository (`git grep -nE '(#|//|/[*]) ?shortcut:'`) for deliberate shortcuts (`shortcut: <limit>, <when to revisit>`). A shortcut whose limit is not yet crossed by the expected load is an accepted decision, not a finding; list it in the inventory. Flag as a finding any shortcut with **no trigger** (rot risk) or whose limit the current or expected load has already crossed.

### Report format

Write `.baco/logs/revisoes/arquitetura-auditoria-NN.md` with:
- Snapshot (`branch`, `HEAD`, date) and expected load read from `docs/arquitetura/README.md` (or state that it is missing).
- Drift summary: code vs `docs/arquitetura/README.md` and accepted ADRs.
- Findings ranked `crítico` (exposes data, breaks a spec/ADR guarantee or risks failure at current load), `importante` (real drift, costly coupling, missing config/transaction boundary, expired or triggerless `shortcut:`), or `sugestão` (safe incremental improvement). Each finding names `file:line`, concrete consequence and smallest safe fix.
- Shortcut ledger: total `shortcut:` markers found, how many lack a trigger, and how many crossed their limit.
- `Não verificado:` what could not be inspected or run.

Present the findings to the person in plain pt-BR. Turning any finding into code happens through a `Revisit` (if an ADR changes) or a normal delivery plan, never during the audit.

## 3. Measured protocol for performance or structural evolution

When a `Revisit` or a technical change without behavior change is triggered by slowness or structural debt on an existing system:

1. **Safety net and baseline first.** Confirm the relevant behavior has automated tests, then measure the real baseline before editing anything (latency, query plan via `EXPLAIN`, memory, call count). Never optimize from a guess.
2. **Cheapest fix first.** Attack in order: algorithm and unnecessary work, N+1 queries, missing indexes (including foreign keys and tenant keys) and bounded/keyset pagination. Only consider adding cache, queues or replicas after the cheaper fixes are measured and still short of the target.
3. **Before/after record.** Measure the same scenario after each change. Revert any optimization that did not move the measured number.
4. **Separate structure from speed.** Keep structural refactoring and performance optimization in separate tasks or commits so regressions are easy to isolate.

## 4. Safe transition plan for live systems

When a `Revisit` or technical change alters a database schema, public contract, storage or runtime in a system that already serves real users or data, the new ADR includes a `Plano de transição e lições aprendidas` section covering:

1. **Compatible migration (`expand -> migrate -> contract`).** Add the new column, table or route alongside the old one; backfill in idempotent batches with reconciliation checks; switch reads and writes; remove the old path only after an evidence window of zero use that covers periodic jobs and backups. An offline maintenance window is allowed only when explicitly approved by the human.
2. **Separated rollback and point of no return.** State separately how to roll back code, configuration, traffic, schema and data. When a step cannot be rolled back cleanly, name the point of no return and the roll-forward plan.
3. **Abort criteria.** Name the concrete signals that stop the rollout (error rate, latency, data mismatch, failed health check).
4. **External consumers.** When external integrators or clients depend on an API, state the coexistence and deprecation window before removing fields or routes.
5. **Lessons learned.** In an ADR that supersedes an earlier one, state in two or three lines what was learned from the previous choice so future work does not repeat the same assumption.
