# Phase 9: Reconciliation

Output: an audit of the delivered code against the planned spec version, the updated catalog, QA, ADRs, plan and roadmap, the lessons in `progresso.md`, and the documentary reconciliation done. Load this reference after the delivery merged ([delivery.md](delivery.md)). Also load [common-process.md](common-process.md): its step 5 (the two-way documentary reconciliation gate) applies here, and [spec-change.md](spec-change.md) for divergences.

Roles named below are subagents when the host has them; otherwise run the role inline in the session. Never ask a non-developer to run an engine command, and when an exit 1 or 2 is a guard doing its job, say so in plain words. Times written to records come from `date`. The catalog is the only record of what reality is, and this phase is the only one that moves `Implementação`, `Versão implementada`, `Validação` and `Versão validada`. Never move them on faith: only on evidence from this delivery.

## 1. Where the edits go

The target branch is protected, so documents are not edited on it. Create a short branch from the updated target:
- **With an `origin` remote:** `git fetch origin <target>` then `git switch -c baco/ENT-NNN-RECON origin/<target>` (no need to switch the main checkout onto a protected branch). If you also fast-forward the local integration branch under `delivery.integration_merge: auto`, always run `git switch <integration>` before `git pull --ff-only origin <integration>` (which does not ask under `auto`; pushing or merging into `main` always asks).
- **In a local-only repository (no remote):** create the branch straight from the local target with `git switch -c baco/ENT-NNN-RECON <target>`.

Run `baco check-branch` before editing. Land it like any change once the work is done: pull request when the tracker is GitHub, local merge otherwise, with the approval rules of [delivery.md](delivery.md), section 6. Write the merge approval of the delivery (date, target, who approved, accepted blockers) in `progresso.md` here. After it lands, `baco cleanup-branches` removes this branch like the others.

## 2. Audit spec and code

Run the role [reconciler](roles/reconciler.md) on the delivered state (the commit where the delivery landed), with: the spec at the version in the plan header, the plan and its coverage table, the traces, the verdicts, the QA files and evidence, the ADRs, `docs/arquitetura/README.md` and the catalog row (`baco catalog get <CODE>`). It audits and proposes; it edits only files you assign on the RECON branch, and runs no test of its own. Record the run with `baco cost add ENT-NNN --phase 9 --agent reconciler --model <m> --effort <e>`.

For every definition of the cut (RF, RN, RNF, INV, CA) it reports one status with evidence (`file:line`, a test, a trace line):
- **cumprida**: the code does what the text says, and a test or a verifiable fact shows it;
- **parcial**: part is missing; say which part;
- **divergente**: the code does something different from the text;
- **excedente**: the code does something the spec never asked for;
- **sem prova**: nothing verifiable either way (typical for an RF or INV that no CA covers).

A behavior the spec does not mention (`excedente`, or any divergence about it) is first checked with one question: is it a business rule? If it is not (keyboard focus, tie-break by millisecond, internal ordering, component details), record it in the reconciliation report as **detalhe técnico, fora da spec**, with the evidence, and do not propose a spec change: the spec gains only business rules. It is not a divergence to decide in section 3.

The trace proves CAs only. A CA `proven` is not proof of the RF or RN above it unless the semantic link holds (actor, operation, boundary, polarity, effect). Never claim a check that was not made; separate **proposto**, **alterado** and **verificado**.

## 3. Divergences are the human's decision

For each `parcial`, `divergente`, `excedente` or `sem prova` item that is a business matter (a technical detail is only reported, section 2), tell the user in plain pt-BR what the spec says, what the product does, and what it means for them. Then ask, one divergence at a time, with your recommendation:

> A spec diz [o que o texto manda], mas o produto faz [o que faz]. Posso: (1) **corrigir o produto** para seguir a spec, ou (2) **mudar a spec** para refletir o que o produto faz (isso gera uma nova versão e precisa da sua aprovação). O que prefere?

- For an `excedente` that is a business rule, the question is the same, with the second option "put the rule in the spec". Do not offer to take a technical detail into the spec.
- Fix the code: plan a small correction delivery through [planning.md](planning.md) (cut = these IDs), never an edit on the merged work outside a delivery.
- Evolve the spec: [spec-change.md](spec-change.md), with impact analysis, new version in the same file and the `spec_approval` gate. Never edit a spec to make it match the code silently, and never edit the code to match a spec the human has not decided about.
- While a divergence is undecided, do not mark the spec as implemented or validated (section 4).

## 4. Update the catalog

Only after the audit and the human's decisions:

```
baco catalog set <CODE> --implemented <version>@<sha>@ENT-NNN --impl-state <state> --validation <state> [--validated <version>]
```

- `<version>` is the spec version the delivery was planned and built on. `<sha>` is the merge commit of the delivery on the integration branch (the one the `entrega/ENT-NNN` tag points to, which `baco cleanup-branches --apply` creates), never the tip of the delivery branch `baco/ENT-NNN`: `git rev-parse entrega/ENT-NNN` when the tag exists, otherwise the merge commit on the target branch. When the integration branch was fast-forwarded to the main branch after the promotion, the first merge on its history that brings the delivery in is the promotion merge on main, and the tag points there: same code, and that sha is a correct baseline. That sha is the baseline of the next `baco spec-diff <spec> --base auto`, so it must be right.
- `--impl-state`: `implementada` when the delivery covered the whole approved version and the audit found no open divergence. `em implementação` when only a cut was delivered, or while a divergence is open; both still record `--implemented <version>@<sha>@ENT-NNN`, and the cut or the divergence is written in `progresso.md`. `não verificada` means "not checked yet" and is not used for an open divergence; use it only when the audit could not run. `não iniciada` never applies here.
- `--validation`: `validada` only when every CA of the plan is `proven` in the final traces (manual ones with an `aprovado` row of this delivery), the external verdict is `aprovado` and no divergence is open; add `--validated <version>`. When every CA is proven the same way but the external review was waived (a current waiver, no approved verdict), use `validada sem revisão externa` instead, with `--validated <version>`; say so plainly to the user. `validada` is reserved for deliveries with an approved external verdict. `parcialmente validada` for a cut or for criteria still pending; `não conforme` when a criterion or a divergence is a known failure; `pendente` when nothing was validated.
- The engine rewrites only that row. `Versão` and `Situação documental` (the approved version) are edited by hand and only by the spec phases. Re-read the row with `baco catalog get <CODE>` and confirm the values.

Repeat for each spec of the plan.

A technical-only delivery ([architecture.md](architecture.md), "Technical change without behavior change") skips this section: every spec keeps its `Versão` and its states. Record the delivery and its ADR in `progresso.md` instead.

## 5. QA, ADRs, plan, roadmap, lessons

- **QA** ([cenarios-qa.md](../templates/pt-BR/cenarios-qa.md)): every scenario of the plan's CAs has its result: an automated one in the traces, a manual one as an evidence row for this delivery (recorded earlier with `baco qa-evidence`; never add one now for a test that was not done). Check `Versão da spec` of each QA file against the planned version. A scenario left `pendente`, or a manual one with no evidence, is reported as a gap with its effect.
- **ADRs:** update status or consequences of those the delivery changed. An accepted decision is never edited away: a new ADR replaces it and the old one becomes `Substituída`.
- **Plan:** replace "ainda não executado" in `plano.md` `Reconciliação` with what changed from plan to result: tasks added or cut, FIX and INT tasks (the files `tarefas/FIX-NN.md` and `tarefas/INT-NN.md`), review rounds, leftovers and why.
- **Roadmap and indexes:** mark the delivery done in `planejamento-do-produto.md` and keep the project's indexes and `anotacoes-futuras.md` in line (section 6).
- **Lessons:** add or extend `## Lições aprendidas` in `progresso.md`: up to five bullets, each from evidence of this delivery (a task class that was wrong, a finding that recurred, a test command that hid failures, a lane that collided, a cost that surprised). Say what to do differently next time. A lesson that implies a rule change (config, plan or spec) is proposed to the human, never applied alone.
- **Cost:** measure again, so the reconciliation itself counts (`baco cost measure ENT-NNN --conductor-harness <harness> --write`, with your own harness, which replaces the earlier measurement of the delivery), then `baco cost summary ENT-NNN`, and tell the user in plain words how much the delivery used in tokens, by harness and model, how much of it was the conductor (its share and its largest context in one response) and how much the subagents. The rows of `baco cost add` only say who ran; their tokens, when any, are what the host reported and are not the total.

## 6. Documentary reconciliation gate

Run the gate of [common-process.md](common-process.md), step 5, with this cut: the delivered result against the approved spec, QA, ADRs, the plan and delivery records, the catalog, the roadmap, the future notes and the indexes. Confront both ways: what the delivery resolves or changes in those documents, and what they still demand or contradict. Classify each affected record, reconcile for real where you may write, and re-read the files actually changed. If you cannot access or may not write a document, deliver the actionable delta and mark the reconciliation pending; never declare it synchronized. Report: sources inspected, files updated, items kept, pending items, no-impact items.

Cases to keep in mind:
- **A spec absorbs a future note:** check the meaning, then close the note per the project's convention: close it pointing to the spec; Git keeps its text. Never leave it open as if nothing happened.
- **Partial absorption:** link the part the spec covers and keep the rest pending with its impact and destination. A title that appears in the spec does not close the whole note.
- **A complementary document demands a contract the spec omits** (minutes, decisions): report the gap and return to modeling before saying anything is complete; consistent internal criteria are not enough.
- **Source conflict** (spec versus a confirmed decision or a policy, authority unclear): report both with evidence and ask the competent decision; never settle it by your interpretation or update a policy silently.
- **Explicit future out of scope:** keep it as future with "no current impact"; it blocks nothing and is not added by yourself.
- **No permission to write:** give the delta per file and the sync status "pendente"; edit nothing, claim nothing.
- **Inaccessible source:** state the limit and its effect on completeness; do not pretend you read it or that nothing is pending.
- **Several documents just produced** (bootstrap): check status and links across them, not each one alone (a vision saying "candidata" next to an index saying "aprovada" is a defect).
- **Audit only:** record the finding, severity, destination and recommended fix; change nothing.
- **Planning stage:** check coherence and flag blockers; edit only authorized planning documents, keep the contract and the human gate for publishing tasks; never publish issues to "fix" a mismatch.
- **Nothing changed:** write "no impact" with the sources checked; do not invent backlog to look busy.
- **Partial deliverable:** reconcile only the delivered cut, keep the rest with its consequence, and state the limit; do not demand a full review or force decisions closed.
- **History and identifiers:** a resolved note with a public ID or an issue link: close it pointing to the spec that absorbed it, citing that ID or link; Git keeps its text. Never renumber.
- **Write without read-back:** a positive answer from a write is not proof; re-read, and if the old state remains, reconcile again or report the failure.

## 7. Closing

Finish with: the audit verdict per spec, the divergences and the human's decisions, the catalog values written (read back), what is pending (each item explained in plain words, never by ID alone, keeping specialist QA scenarios out of chat summaries and questions; they remain listed apart in `progresso.md`, `aceite.md` and the PR), the technical details left out of the spec, the lessons and the cost summary, in the communication pattern of `SKILL.md`. With `github.project` set, run `baco board ENT-NNN --apply` after reconciliation lands so the parent issue and every task are synced to `Done`. Run `baco validate-spec <spec>` for any spec touched. The next delivery starts again from [planning.md](planning.md), where `baco spec-diff <spec> --base auto` now measures from the sha you recorded.
