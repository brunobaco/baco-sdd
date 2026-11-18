# Spec audit and readiness protocol

Load this reference to audit a spec, and during the review steps of creating or evolving one ([spec-model.md](spec-model.md), [spec-change.md](spec-change.md)). It is the working protocol of the role [spec-auditor](roles/spec-auditor.md) (judgment: gaps, contradictions, traceability). The role [cold-reader](roles/cold-reader.md) complements it: it reads only the spec, without conversation or other sources, and lists what it could not build or test from the text alone ([common-process.md](common-process.md), step 4). Without subagents, run either role inline in the session.

## Cut and evidence

Identify the source actually consulted (name/path, version/branch/commit when they exist), the audited scope, and the relations with vision, decisions, policies, adjacent specs and available QA. If access is missing, say so and weaken the conclusion accordingly. Never use the state of the code as a substitute for the contract. Run `baco validate-spec <spec>` as mechanical input (duplicate IDs, CAs without Dado/Quando/Então, missing acceptance section, version mismatch, dangling references); a clean run is not a semantic review.

## Semantic review

Check, as pertinent:

- **Problem/scope:** purpose, actors, outcomes, exclusions, interfaces between capabilities.
- **Authorization/data:** allowed and denied operations, ownership, isolation, access to personal data, authentication failures.
- **Rules/behaviors:** eligibility, conditions, effects, state, exceptions, limits, reversal, repetition, concurrency, time.
- **Experience/integrations:** success/error feedback, absence of data, unavailability, integration failures, accessibility and non-functional needs when required.
- **Consistency:** divergences between documents and versions, normative duplication (the same content restated in two documents instead of referenced), swapped terms, inheritance, cross-cutting policy and related impacts.
- **Acceptance and QA:** scenario with observable condition/action/result; positive and negative coverage; effective references. Check **inclusive/exclusive boundaries and polarity**: testing refusal beyond the limit does not show permission at the limit. Compare a declared count with the documented items, but do not infer lost scenarios from a numeric difference alone. Check that each scenario has its `Automação` status and that the QA records the exact spec version.
- **Semantic traceability:** for each RF/RN/INV → CA/QA link, confirm the scenario really tests the actor, operation, condition and outcome of the contract. CAs about cancelling someone else's booking do not automatically validate requirements about cancelling one's own. Cited IDs or existing links do not mean complete coverage.

## Proportional assessment of cohesion and functional decoupling

Apply it in audit, and in the reviews of create and evolve; in planning, use it to guide decomposition (the planning reference, `planning.md`). First identify purpose, normative authority and the input/output contracts of the capabilities. Register a finding only with **concrete evidence, functional consequence and reach**. Examine:

| Verifiable question | Material signal and possible consequence |
|---|---|
| Does the rule have a single authority and consistent references? | Two current contradictory rules for the same operation produce incompatible results; divergent copies threaten integrity and review. |
| Do the behaviors belong to a cohesive purpose? | A capability bundles flows with no common outcome and changes for unrelated reasons, hindering test and evolution; split only on a real boundary. |
| Is the dependency minimal, explicit and legitimate? | A consumer depends on uncontracted internal state, or a local change forces an unnecessary change to another contract, causing regression. |
| Is the failure isolable without violating guarantees? | Unavailability of an ancillary function blocks a valid action; conversely, authorization/integrity validation must not be skipped to raise availability. |
| Do stable contracts allow independent evolution? | A local change propagated without shared semantic change suggests accidental coupling; a changed shared contract may justify joint evolution. |

**Proportionality test:** describe the concrete scenario, sources/IDs, dependency, the outcome that breaks, impact and minimal recommendation. With no consequence, classify it as an observation or absence of problem, not a defect. A dependency cycle is not, by itself, a failure; investigate whether there is ambiguous authority, a blocked outcome, or joint evolution without functional reason.

Do not prescribe microservices, events, repository splits or stack. Do not equate a good spec with the real implemented architecture. Preserve integrity, consistency, authorization and atomicity; do not fragment transactions or duplicate normative rules to maximize independence. Do not reopen a valid approval, and do not create a human decision for a delegable technical choice without material evidence of contractual conflict.

## Two-way reconciliation of complementary documents

Beyond the semantic review of the spec, examine relevant accessible documents that record decisions, future questions, governance, history, policies, QA, adjacent contracts, journeys and indexes (the catalog included). Check:

- **Complementary → spec:** items recorded as decided that did not reach the contract, decisions of a higher source contradicted, forgotten material gaps, or problems only partially specified. Do not force in future ideas explicitly out of the current scope.
- **Spec → complementary:** notes still open that are now fully resolved, pending items with a smaller residual scope, outdated destination decisions or links, QA/history/indexes that need updating.
- **Meaning and status:** show whether the content is resolved fully, partially, future, conflicting, obsolete or without impact. A superficial mention of a topic does not prove resolution; preserve history and never turn a hypothesis into approval.

In an **audit**, deliver the recommended documentary deltas with origin and destination, without editing by default. In **creation or evolution with write authorization**, carry out the reconciliation on the affected set and verify the changes by re-reading. A material decision divergence needs legitimate arbitration, not a silent fix. Report documents not accessed, and separate functional delivery from pending documentary sync.

## Severity and reach of a block

- **Bloqueante:** an unmitigated security/integrity risk, or a contradiction/missing decision that prevents an essential behavior of the analyzed scope. Name the blocked operation.
- **Alta:** a relevant implementation difference or a likely functional failure, which may not block independent components.
- **Média:** incomplete coverage, workable ambiguity, redundancy with real maintenance risk.
- **Baixa:** editorial issue or imprecise reference with little functional impact.

The severity of a **wrong QA count** depends on the claim attached to it: an isolated editorial error may be low; using that count as evidence of complete coverage or readiness raises it. The difference does not prove deleted tests.

Do not treat a future topic explicitly excluded as a V1 defect. Do not promote a technical choice to a human decision when the verifiable behavior is already defined. A finding may be high and have localized reach; severity and reach are different dimensions.

## Severity of code findings

The code reviews (task review in phase 6, final review and PR review in phase 7) grade each finding `crítico`, `importante` or `sugestão` by two things together: how likely it is to happen and what it does when it happens.

- **`crítico`:** it happens in normal use, with any person using the screen the ordinary way, and it leaves wrong data saved, shows restricted data to someone who may not see it, or leaves a permission in force that should not be. A failing test of the task, or a CA that the code does not meet in normal use, is also `crítico`.
- **`importante`:** a bug in normal use with a smaller effect (a wrong message, a screen that does not refresh, a lost filter), a missing or weak test that should exist (a test that cannot prove what its scenario or rule says), or an atypical case that exposes data or a permission.
- **`sugestão`:** everything else, including an atypical case that exposes neither data nor a permission.

An **atypical case** is one that needs something the ordinary user does not do: a race of milliseconds between two requests, an unusual combination of tabs or windows, a volume nobody reaches, an input the screen already prevents. An atypical case is never `crítico`: at most `importante` when it exposes data or a permission, otherwise `sugestão`. The finding says why it is or is not normal use. A spec item that asks for that exact case (an INV, an RN, a CA, a QA scenario about concurrency or volume) makes it normal use for that delivery.

## Handling review findings

These rules apply to every review of the method: spec reviews (phase 2), task and final reviews (phase 6 and 7) and the external review. Other references point here.

Each finding gets exactly one of four outcomes, recorded with its reason:

1. **Fix:** change the document or the code, and re-check the point.
2. **Contest:** the finding is wrong or does not apply. Contest only with evidence the reviewer can read (a path, an ID, a line, a test output). A contest without readable evidence is not a contest.
3. **Escalate:** a person must decide (product, risk, money). Say what is open and the recommendation.
4. **Decline as detail:** real but harmless, with no consequence for the contract or for the delivery. Say why it changes nothing.

Rules:
- A **comprehension gap is never contested.** If a reader could not understand the text, the text is what gets fixed, even if the intent was right.
- **Severity only changes by contesting**, with evidence. Nobody lowers a finding quietly by rewording it.
- **Alert when a fix undoes an earlier fix.** Before applying a fix, check the history of the document or the earlier findings; if the fix reverses what an earlier finding made you do, stop and put both findings in front of the human, instead of going back and forth.
- Contested and escalated items never stop the other work in autonomous execution ([implementation.md](implementation.md)): they go on the end-of-run summary for the person.

## Recording findings

Use `ID | Severidade | Evidências/localizações | Consequência | Recomendação | Precisa de decisão humana? | Escopo afetado`, but do not impose a long table for two findings. Cite excerpts/IDs/lines you actually read. Classify each statement as fact, interpretation or risk when needed. Avoid long reproductions.

**Claims about commands.** No review states from reading alone that a command works or fails (install, build, test, migration, start). Run it and cite the command, its exit code and the lines of the output that matter, or write the point as not verified (`Não verificado:` in the report, "não verificado" in the finding). A command that writes (an install, a build) never runs in the folder under review: run it in a scratch copy, a new worktree of the commit under review (`git worktree add --detach .worktrees/copia-<papel>-NN <commit>`), which the conductor removes after the review (`git worktree remove --force <pasta>`). A reviewer whose brief or sandbox forbids writing (the pr-reviewer in mode `pr`, a read-only harness) runs only what writes nothing and marks the rest not verified.

## Single readiness verdict

Apply **one classification per cut** and keep title, summary and caveats coherent:

- **`apta`** (ready for planning/implementation, subject to the required approval): essential behaviors are specified and verifiable, with no blocking functional decision.
- **`apta com dependências`** (declared dependencies): the functional contract of the cut is sufficiently defined; integrations, technical choices or delimited external dependencies have identified owners. Never use this class to mask blocking product decisions.
- **`bloqueada`** (in the stated cut): a material ambiguity or conflict prevents reliable implementation of that cut.

For composite specs, state which sub-operations are `apta`, `apta com dependências` or `bloqueada`. Do not reduce the whole document to `bloqueada` if only one independent operation is undefined; do not call the global spec ready if any V1 operation is still blocked.

Always separate: contract readiness, **human approval**, implementation, documented QA and executed tests. Never invent coverage percentages or presumed approval.

## Audit output

Deliver sources/cut, prioritized relevant findings with evidence, reach of the blocks, a coherent verdict and next steps. Without authorization, do not change the original. In evolution, present the impact analysis first, then the proposed delta, followed by the needed QA and history updates. Include the reconciliation status (consulted / updated / no impact / pending access or authorization), never claiming an unverified sync. To the user, in plain pt-BR, following the communication pattern of `SKILL.md`:

> **Entendimento:** auditei [spec, versão] com base em [fontes]. **Achados:** [n] bloqueantes, [n] altos… (os principais: …). **Recomendação:** [parecer: apta / apta com dependências / bloqueada, e o recorte]. **Próximo passo:** [uma ação ou pergunta].
