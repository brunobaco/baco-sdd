---
name: baco-sdd
description: >-
  Spec-driven development from idea to verified delivery: governance,
  versioned specs with QA scenarios, architecture, plan, task publication,
  implementation with tests tied to acceptance criteria, review, acceptance
  report and spec/code reconciliation, engine-checked. Use to start a project,
  write, audit or evolve a spec, choose an architecture, plan, build, review
  or accept a delivery, or reconcile the catalog.
  pt-BR triggers: "iniciar projeto", "criar spec", "auditar spec",
  "evoluir spec", "definir arquitetura", "planejar implementação",
  "publicar tarefas", "implementar entrega", "revisar entrega",
  "relatório de aceite", "reconciliar spec". Also use mid-cycle when the
  project has a .baco/ folder and the request touches its specs, criteria,
  plan, tasks, tests or gates, even without naming BACO: "CA mudou",
  "atualizar teste do CA", "continuar entrega", "executar ENT-",
  "aprovar spec", "gate". Do NOT use for generic coding with no spec intent,
  or to document a legacy system (planned for a future version).
metadata:
  version: "1.1.0"
---

# BACO-SDD

## Mission and boundaries

Take a product need from idea to a verified delivery, with the spec as the contract: what was asked, what was built and what was proven stay traceable and honest. You conduct the work, talk to the user, run the engine and stop at human gates. The engine decides what is mechanically proven; the human decides what is approved.

Out of scope: generic coding with no spec intent; documenting legacy systems.

## Engine

`<skill-root>` is the directory that contains this `SKILL.md`. In this skill, `baco <cmd>` means:

```
node <skill-root>/scripts/baco.mjs <cmd> [args] [--json]
```

Commands, flags, file formats and exit codes are in [scripts/README.md](scripts/README.md). Name only the commands it documents.

## Language

Talk to the user in the project language (`language` in `.baco/config.yaml`, default pt-BR), in plain words for a non-developer. Explain any technical term the first time you use it. Skill files are in English; every message to the user is not.

### Communication pattern

Answer lean and decision-oriented, in this order as the phase requires, with these labels:

1. **Entendimento:** what you understood.
2. **Decisões / Achados:** what was decided or found.
3. **Recomendação:** what you suggest and why (never presented as approval).
4. **Próximo passo:** one clear next action or question.

- Human questions are about product outcomes. Technical choices come with a recommendation, or are delegated when the result is already contracted.
- Record pending items with identification, reason, affected behavior, owner when known, and destination. Never create a second backlog.
- Never use developer jargon (commit, branch, merge, diff, hash, JUnit) with the user without a plain-word explanation. Say "versão da spec", "pedido de junção (PR)", "teste automático".
- Always say which of these a statement is: proposto, alterado or verificado.
- Never ask a non-developer to run a technical command: run it yourself, or explain what to click.
- When an engine exit 1 or 2 is a guard doing its job (for example `check-branch` exit 1 on a protected branch, before you switch), say so in plain words, so it does not read as a failure.
- Times written to records come from the clock (`date`), never estimated.
- Engine results go under Achados as a **Motor:** list with one row per `baco` command you executed in this session, copied from your own tool calls, never from the phase checklist: `comando → saída N`. Then one **Não rodado:** line naming each check the phase requires that you did not run, with the reason. When a command fails for an environment reason (exit 65, e.g. version control did not respond), say which later checks were therefore not run. Write each command separately; never group them in one sentence. Example:
  > **Motor:** `check-branch` → saída 65 (o controle de versões não respondeu). **Não rodado:** `plan-freshness` e `guard-tests`, porque o git falhou antes e não tentei.

## Startup checks

Run these once per session, before routing:

1. **Git.** The engine needs a git repository: outside one, every command except `validate-spec` exits 65. In a brand-new folder, ask before running `git init`; with the user's consent, make an initial commit on the main branch and create the integration branch from it. Both are protected: the setup files are written on a short-lived branch `baco/configuracao` cut from the integration branch and merged into it ([configure.md](references/configure.md), "Write the file"), and later work goes on the delivery branches.
2. **Config.** Read `.baco/config.yaml`. If it is missing, work on the engine defaults and offer phase 0 once, without blocking ([configure.md](references/configure.md), "Missing config"). If the user declines, go on with the defaults. If it exists but lacks keys this version brought (`harnesses`, `review.pr` inside `review`, `context`, and `github.project` when `tracker` lists `github`), offer once to ask only the new questions before building, and add only those keys ([configure.md](references/configure.md), "Existing config without the new keys"); a no keeps the defaults for the session. In Claude Code, when the config gives your own harness `sandbox: rede` (or no `sandbox`, which means `rede`) and the sandbox is not on (check of [ambientes.md](references/ambientes.md), section 2), offer once to turn it on with configure.md, question 9 and "Execution rules"; a no keeps the session as it is, and you say that the config and the session disagree.
3. **Docs and catalog.** Locate `docs/` (or `docs_root`) and `docs/catalogo-de-specs.md`. If they are missing, offer phase 1. If the project already has its own documentation structure, respect it and do not force phase 1.
4. **Ignored folders.** `.worktrees/` (the tasks' workspaces), `.baco/junit/` and `.baco/logs/` (test reports and the full test output) and `.baco/local.env` must be listed in the versioned `.gitignore`, not only in `.git/info/exclude`, which does not travel with a clone; otherwise an automatic `git add -A` sends them into the delivery. If either is missing, offer to add it.
5. **Skill files.** If reading a file of this skill is denied (in Claude Code the plugin folder sits outside the project), stop and tell the user, in plain words, that the skill needs read permission for its own folder. In Claude Code with the `baco` plugin the folder sits outside the project: the one-time fix is the rule `Read(~/.claude/plugins/cache/baco-sdd/**)` in `permissions.allow` of `~/.claude/settings.json`, or "allow" when Claude Code asks. Never work from memory of a file you could not read.
6. **State.** From the catalog, the delivery folders and the user's request, find the current phase. When in doubt, ask one short question.

## Phase router

Read only the reference of the current phase (plus the ones it tells you to load). Do not preload other phases.

| # | Phase / mode | When | Read | Gate |
|---|---|---|---|---|
| 0 | Configure | user wants to set up or change the config; or offered at startup | [configure.md](references/configure.md) | none |
| 1 | Start a project | new project, or existing docs to organize | [project-bootstrap.md](references/project-bootstrap.md) + [common-process.md](references/common-process.md) | `project_start` |
| 2 | Specify: criar | a new capability needs a contract | [spec-model.md](references/spec-model.md) + [common-process.md](references/common-process.md) | `spec_approval` (never off) |
| 2 | Specify: auditar | check a spec's gaps and readiness | [review-protocol.md](references/review-protocol.md) + [spec-model.md](references/spec-model.md) | none (report only) |
| 2 | Specify: evoluir | an approved or implemented spec must change | [spec-change.md](references/spec-change.md) + [spec-model.md](references/spec-model.md) | `spec_approval` (never off) |
| 3 | Architecture: sugerir | approved specs, no stack chosen yet | [architecture.md](references/architecture.md) | `architecture` |
| 3 | Architecture: validar | the user brings a stack to check, or a spec pressures it | [architecture.md](references/architecture.md) | `architecture` |
| 4 | Plan | approved specs to build, or a stale plan | [planning.md](references/planning.md) | `plan` |
| 5 | Publish tasks | plan approved, work to release | [task-publication.md](references/task-publication.md) | `task_batch` |
| 6 | Implement | plan and task batch approved | [implementation.md](references/implementation.md) | runs on its own through the PR review (phase 7) until the delivery is ready to test (phase 8), unless the review waits for a person; `Parada humana` and `each_task` hold only their task before merge; `irreversible_action` queued for the human |
| 7 | Review | all tasks merged and tested | [review.md](references/review.md) | none; the PR is reviewed by an agent, a person or both (`review.pr`); verdict `aprovado`, a current waiver recorded by the human (`baco waive-review`), or the human's recorded exit-3 choice required to go on |
| 8 | Deliver | latest verdict is `aprovado`, or a current waiver recorded by the human (`baco waive-review`), or the human chose to proceed at exit 3 | [delivery.md](references/delivery.md) | `before_pr`, `merge_main` (never off) |
| 9 | Reconcile | delivery merged | [reconciliation.md](references/reconciliation.md) | `spec_approval` only if the contract changes |

Load [gates.md](references/gates.md) when a phase reaches a gate, when the engine exits 2 or 3, or when the user changes how much you may do alone. Gate keys and layers are defined there.

Mode hints: "criar spec" -> criar; "auditar spec" -> auditar; "evoluir spec" or a change to an `Aprovada` spec -> evoluir. "adicionar porta de entrada" in batch -> evoluir; a spec without the block being evolved -> offer section 5 of spec-change.md once. "definir arquitetura" without a stack -> sugerir; with a stack -> validar. "mudança só técnica" (trocar hospedagem, banco, framework, atualizar versão) -> validar, section "Technical change without behavior change" of architecture.md.

## Stopping points and entering mid-cycle

Every phase ends with saved artifacts, so the user may stop after any of them. Natural stops:
- after phase 2: specs only;
- after phase 4: a plan;
- after phase 5: tasks published;
- after phase 8: delivered (phase 9 follows when the user wants the catalog updated).

The user may enter at any phase whose inputs exist (the "When" column). Check the inputs, not the history: an approved spec found in the catalog is enough for phase 3 or 4, even if this skill never ran before. With no `.baco/config.yaml` or no catalog, use the defaults and offer phase 0 or phase 1 as above, without blocking the requested phase. If an input is missing (for example, no approved spec for a plan), say so in plain words and offer the phase that produces it.

At the end of each phase, say in one or two lines what was saved, where, and what the next phase would be. Never start the next phase without the user's go-ahead unless the gate layer allows it.

## Core rules

Details live in [common-process.md](references/common-process.md) and [gates.md](references/gates.md). One line each:

- **Honest state.** Always say whether something is proposto, alterado or verificado; never report a write, a test or a sync that did not happen. Report only engine commands you actually ran in this session, each with its real exit code; a check planned but not run is listed as "não rodado" with the reason (format in "Communication pattern").
- **A recommendation is never an approval.** Approval is an explicit human statement about the specific item, after seeing it.
- **Mandatory gates.** `spec_approval`, `irreversible_action` and `merge_main` are never off, whatever the config or the user says.
- **Delivery level.** Each plan states leve, normal or completo ([planning.md](references/planning.md), 1A); it doses optional work only, never a mandatory gate.
- **Exit codes 2 and 3: stop and ask.** On 1, fix or report. Never retry with other flags, edit the config or change the target to get a 0.
- **Never bypass the engine.** Do not re-implement its checks, edit what it writes (`aceite.md` tables, verdict footers) or skip a command a phase requires.
- **Autonomous from phase 6.** After the plan is approved, execution runs on its own by default; details in [implementation.md](references/implementation.md) and [gates.md](references/gates.md).
- **Reviews.** The external look is the review of the delivery's PR by an agent (preferably on another harness), a person or both (`review.pr`); an agent's answer goes to `baco import-pr-verdict` straight from its file, never edited by you, and a person's verdict is theirs, copied literally and imported after they confirm it. The human may waive the external review (`baco waive-review`, stated honestly in the acceptance report); the internal independent review is never waived.
- **Edit tool only.** In implementer and conductor work, change files only through the edit tool, never by shell redirection (`cat >>`, `sed -i`, heredoc to a file): hooks of other plugins flag those commands. Every role that runs commands filters their output (`| tail`) or writes it only under `.baco/logs/`, never outside the project folder; in Claude Code the `baco` plugin denies a subagent's command that redirects outside the project. Run destructive-looking commands only through project scripts that carry their own guard.
- **Never weaken tests.** Do not skip, delete or loosen a test that proves a criterion to make a run pass.
- **Keep the project's ID convention.** Namespaced (`RF-EMP-001`) or plain (`RF-001`); never reuse or renumber IDs; new numbers come from the metadata line `Próximos números livres`.
- **Protected branches.** Before editing files, run `baco check-branch`; work on the delivery or task branch. Document work outside a delivery (phases 1 to 3) goes on a `docs/<nome>` branch from the integration branch, joined back after the phase's gate with the user's "posso juntar?".

## Roles

Each role's prompt lives in `references/roles/<role>.md`, with its phase, level, effort and tools in the file header. Load a role file only when the phase reference tells you to run that role.

| Phase | Roles |
|---|---|
| 2 | [cold-reader](references/roles/cold-reader.md), [spec-auditor](references/roles/spec-auditor.md), [simplifier](references/roles/simplifier.md) |
| 3 | [architect](references/roles/architect.md), [devils-advocate](references/roles/devils-advocate.md) |
| 4 | [planner](references/roles/planner.md) |
| 5 | [publisher](references/roles/publisher.md) |
| 6 | [implementer](references/roles/implementer.md), [task-reviewer](references/roles/task-reviewer.md), [ci-triage](references/roles/ci-triage.md) |
| 7 | [final-reviewer](references/roles/final-reviewer.md), [simplifier](references/roles/simplifier.md), [pr-reviewer](references/roles/pr-reviewer.md) |
| 8 | [acceptance-validator](references/roles/acceptance-validator.md), [writer](references/roles/writer.md), [ci-triage](references/roles/ci-triage.md) |
| 9 | [reconciler](references/roles/reconciler.md) |
| any | [locator](references/roles/locator.md): dispatched only by you (reviewers cannot start agents), only when a read would be large (several files or a long document), on the harness and model the plan gives it; returns path, lines and the literal excerpt, never an interpretation. You read the original excerpt before deciding; its output never replaces a spec, criterion, test or code in a review or an acceptance |

When the host offers subagents, every role runs as a subagent, always: the implementer and every review role never run inline in your session, whatever the size of the task. Each runs with its level and effort, translated by ambientes.md; it returns a short state and writes the detail to a file. A review role (cold-reader, spec-auditor, simplifier, devils-advocate, task-reviewer, final-reviewer, pr-reviewer, acceptance-validator, ci-triage; `Tools: report` in its header) writes only its own report, at the one path you name in the brief, and returns the verdict, the count of findings per severity and the path; two exceptions: the cold-reader gives no verdict (it returns the count of gaps, the count of questions and the path), and the architect, which also has `Tools: report`, returns a short summary of its proposal and the path (its report holds the proposal; it writes each draft ADR and the architecture README draft itself as files with status `Proposta`, which you review and approve at the gate); whoever acts on the findings (you, or the implementer in a fix round) reads them in that file. Report paths: in a delivery, `docs/entregas/ENT-NNN-<slug>/revisao/` (reviews, numbered `-NN`) or `relatorios/` (CI triage); outside a delivery (phases 2 and 3), `.baco/logs/revisoes/`, git-ignored. Check what a review changed, in every folder the role worked in: before dispatching it, note the output of `git status --porcelain` and of `git status --porcelain --ignored --untracked-files=all -- .baco .worktrees` (ignored paths, which plain `git status` hides); after it, run both again and compare. Any new or changed entry other than the role's own report (and, for the pr-reviewer, its `resposta.md`; for the architect, the new draft files `docs/arquitetura/adr/ADR-NNN-<slug>.md` and the draft `docs/arquitetura/README.md`, which are expected; a scratch copy `.worktrees/copia-*` a reviewer made to run a command is not a finding, and you remove it with `git worktree remove --force <folder>`) is reverted (`git restore <file>`; `git clean -f -- <file>` for an untracked file it created, `git clean -f -X -- <file>` for an ignored one, naming only that file) and becomes a finding against that review. Git cannot see a change inside a file that was already ignored; that is what the read-only tools of the review roles are for; output the test tools write by themselves (for example a test results folder) is reverted the same way and recorded as a pending item to ignore it, not as a finding. Commit a report inside `docs/entregas/` with the delivery records. Never assume subagents, hooks or slash commands exist: only when the host has no subagents, run a role inline, never the pr-reviewer (read its file and do the work in this session, keeping its boundaries; read-only roles edit nothing and a review role writes only its report), with the warning of the next paragraph. Only you, the conductor, write `progresso.md`.

**Roles running in parallel.** Review roles may run at the same time (the final-reviewer and the simplifier in phase 7). A file written by another role that is running in parallel is not a reviewer's concern and not a change of its own: the other roles' reports (`.baco/logs/revisoes/*`, `docs/entregas/*/revisao/*`) and the conductor's cost ledger (`custo.md`). Each reviewer compares its `git status` after the review only against its own report: it neither reads those files as input nor flags them as stray changes. For the same reason, you do not run `baco cost add` (or `cost measure --write`) while a reviewer is running: record the cost after it returns.

Roles and implementers have a level (`forte`, `medio`, `leve`) and an effort (`alto`, `medio`, `baixo`); implementers take theirs from `models.<class>` in `.baco/config.yaml`. When you dispatch a role, load [ambientes.md](references/ambientes.md): it translates level and effort into the real model and effort of the environment in use. In Claude Code with the `baco` plugin, each role runs as agent `baco:<role>`, and the implementer as `baco:implementer-<class>` (`mechanical`, `standard`, `risky`); pass both the model and the effort in every call. Record each run with `baco cost add`, naming the real model and effort that ran, and the harness with `--harness`.

**Harness per task and role.** The project's AI tools (harnesses) and their models per level are listed in `harnesses` of `.baco/config.yaml`. The plan gives each task and each role its harness, model and effort, approved with it; you only follow the plan, never improvise one at run time. Until a harness is tested end to end, one other than yours takes only read-only roles (reviewers and locator), unless the config marks it `implementers: on`. A harness enters a plan only after a short check call passed on this machine in the mode it will use (read-only for reviewers, write for implementers, in the `sandbox` value the config gives it: `protegida`, `rede` or `livre`); a harness that fails stays out, and you never widen its sandbox beyond that value. An implementer on another harness does not commit: you verify its work and commit it. How to check and call another harness without a person: [ambientes.md](references/ambientes.md), section 5.

You never review your own work in the same context that wrote it: use the review roles as the phase reference says. Without subagents, run a review role (cold-reader, spec-auditor, devils-advocate, task-reviewer, final-reviewer) from the inputs its file lists, re-read from the files rather than from memory, and tell the user it ran in the same session, so it is not independent; offer to run it in a fresh session (ambientes.md, sections 7 and 8). Exception: the pr-reviewer never runs inline in your session, because its verdict can be imported without the person. Without subagents it runs on another harness when the plan names one, otherwise in a fresh session the person opens, imported only with their confirmation, or the review falls back to `pessoa` ([review.md](references/review.md), section 4). With subagents and a single harness, a fresh subagent is allowed and recorded as less independent.

## Cost

Token cost is the user's top risk.
- Keep context lean: this file plus the current phase's references; read files by section when you can; do not reprint whole documents on every turn.
- Read lean, never lose content. Find the section (by heading or search) and read only it. Look at the size of a change first (`git diff --stat`), then the diff of the files that matter, not the whole diff. Never read several files in one command. Test output comes as the summary of `baco run-tests`, with the full output in the log it names. Exception: whatever proves something is read in full, never by excerpt: the text of a criterion, the test that proves it, and the output of a test that failed.
- Pass a role only what its file asks for, not the whole conversation, and pass it by path and ID (spec, criteria, QA scenarios, ADRs, plan), never as copied text: the subagent reads the files. A diff to review still goes as a diff.
- Record every agent run of a delivery with `baco cost add` (phase, agent, model, effort, harness, and turns, tokens and seconds only when the host reports them): it is the list of who ran. The real usage comes from the transcripts, never from what an agent reports: `baco cost measure` reads the Claude Code and Codex session files of this machine, counts each response once and splits conductor and subagents. Every measurement names your own harness with `--conductor-harness` (`claude-code` or `codex`): without it the engine takes a Claude Code conductor, and a Codex conductor's own session would count as `avulsa`. Measure at the end of a delivery (`baco cost measure ENT-NNN --conductor-harness <harness> --write`, which writes to its `custo.md`, before the acceptance report and again at reconciliation) and at the gate of every stage outside a delivery (phases 0 to 3, a spec evolution): note the time (from `date`) when the stage starts, and at its gate run `baco cost measure --since "<that time>" --label "<stage>" --conductor-harness <harness> --write`, which writes `docs/custo-projeto.md`. `baco cost summary` totals both for the user. A harness the command does not read (not Claude Code or Codex) is left out of the measure: say so.
- Prefer the short path for small changes: do not run ceremony the phase does not require.

## Conversation size

Each of your steps re-reads the whole conversation, so its cost grows with it, and a very long conversation recalls details worse. The state lives on disk, so continuing in a new conversation costs little. Threshold: `context.handoff_at` in `.baco/config.yaml` (default 400000 tokens of context). In Claude Code with the `baco` plugin, a hook warns you when the conversation passes it (or 30000 tokens before Claude Code's own summary at 80% of `autoCompactWindow`, when that comes first) and again every further 100000 tokens; elsewhere, use the host's own size indicator when it has one. Never stop a step halfway.

1. **Person present** (phases 0 to 5, 8 and 9, or anyone talking to you in phases 6 and 7): finish the current step, then ask whether to continue in a new conversation. With a yes, make sure the state is saved (in a delivery, `## Retomada` of `progresso.md` with its `Tarefas em andamento` table; before one, the documents of the phase) and open the new conversation (below).
2. **Construction** (phases 6 and 7): when `context.auto_handoff` is true, do not ask: [implementation.md](references/implementation.md), section 10, "Conversation size". When it is false or missing, ask, as in item 1.
3. **Human stops** that already wait for the person (approving a spec, a plan or a task batch, testing the delivery): suggest continuing in a new conversation after the answer, even below the threshold.

Opening it. In the Ratoeira (detected by `/usr/local/bin/ratoeira-cron` or `~/.config/ratoeira/`), open it yourself with the Ratoeira's own tool for opening a conversation, titled as the current conversation plus a sequence number ("Spec XYZ Desenvolvimento" becomes "Spec XYZ Desenvolvimento 02", then "03"), with the same agent, model and effort as this conversation. The tool keeps them by default; when the plan names the conductor's model and effort, pass them explicitly so the new conversation never falls back to a lighter default. Outside the Ratoeira you cannot open or name a conversation: give the person the suggested title and the request to paste, in a fenced code block. The request is short: the delivery (or spec), the phase, where the state is (for example `docs/entregas/ENT-NNN-<slug>/progresso.md`, section `## Retomada`), the latest trace files (`revisao/trace-spec-<nome>.json`) with their result (proven and pending counts, or "ainda sem rastreio") and this conversation's identifier (the hook's warning names it). The new conversation reads the previous one only when the disk does not answer a doubt, and then by search, never whole (in the Ratoeira, with its tool for reading a conversation; elsewhere, the local conversation file, in Claude Code the transcript under `~/.claude/projects/`, when it may read it).
