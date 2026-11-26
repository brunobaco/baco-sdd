# Phase 8: Delivery

Output: `docs/entregas/ENT-NNN-<slug>/aceite.md` (acceptance report in business language), the manual evidence in the QA files, the delivery's pull request (PR) ready to merge when the project is on GitHub (opened as a draft for the review in [review.md](review.md), section 3), the merge, and cleaned-up branches. Gates: `before_pr` and `merge_main` ([gates.md](gates.md)); the merge into the integration branch asks too, unless `delivery.integration_merge: auto` and `baco merge-check` allow it. Load this reference when the highest verdict of [review.md](review.md) is `aprovado`, when the human recorded a current waiver of the external review (`baco waive-review`), or when the human chose to proceed at the exit-3 decision ([gates.md](gates.md)).

Roles named below are subagents when the host has them; otherwise run the role inline in the session.

**Destination.** `delivery.target` says where the delivery ends: `integration` (the default: the PR goes to `branches.integration`, and a later promotion to main follows section 6b) or `main` (the PR goes straight to `branches.main`). `--target` of sections 3 and 6 is that branch.

**Ready to test.** Reached from the autonomous run ([review.md](review.md), section 7), sections 1, 1A, 3 and 4 run without waiting: the full battery passed, the delivery is reviewed and fixed, and the acceptance report is filled. What follows depends on `delivery.integration_merge`:
- **`ask`** (the default), or a destination that is main: the run stops with the end-of-run summary ([implementation.md](implementation.md), section 11), which says the delivery is ready for the person to test: what changed for them, the PR address (or that the change is on the delivery branch), the criteria left out of this delivery (`fora desta entrega`, always listed in plain words whenever any exist), the manual scenarios still to run (section 2), in the Ratoeira the offer of the preview link with login only for them ([architecture.md](architecture.md), "Preview for the owner"), and the two approvals that stay human: `before_pr` (section 5) and the merge (section 6). The person tests and says "pode juntar"; nothing is merged before that.
- **`auto`**, with the integration branch as destination: push, wait for the PR's CI on that tip in the background, then run `baco merge-check ENT-NNN --target <integration> --pr <number> --apply`. When every condition passes (exit 0), `before_pr` (section 5) and the merge into the integration branch (section 6) run without asking (the engine itself runs `gh pr merge <number> --merge --match-head-commit <tip>` without `--delete-branch` and syncs the GitHub Project board if configured), and the ready-to-test stop moves to after the merge: the summary tells the person where to test what the integration branch publishes (for example homologation), the criteria left out of this delivery (`fora desta entrega`, always listed in plain words whenever any exist), the manual scenarios to run there (never the specialist ones or out-of-scope criteria), and that the merge into main still waits for them. Exit 2: nothing is merged; stop and ask as with `ask`, saying in plain words each condition it listed.

The merge into main always asks the person (`merge_main`, never off): `baco merge-check` never exits 0 for main.

You conduct and decide; the engine decides what is proven. Never ask a non-developer to run an engine command: run it yourself, and when an exit 1 or 2 is a guard doing its job, say so in plain words so it does not read as a failure. Times written to records come from `date`. Never edit `aceite.md` to change a table, a status or a blocker: only the engine writes them.

## 1. Entry

- The highest-numbered verdict is `aprovado`, or a current waiver recorded by the human exists (`baco waive-review`, no verdict imported, [review.md](review.md), section 4), or the human chose to proceed at the exit-3 decision (recorded in `progresso.md`, [gates.md](gates.md)); and no code, test or QA commit came after the commit it reviewed (provenance, [review.md](review.md), section 1). Commits that touch only `docs/entregas/**` are fine, and so are paths listed in `provenance.ignore`. Run logs and notes about a delivery belong inside `docs/entregas/ENT-NNN-<slug>/`. If the engine reports a stale trace, verdict or waiver, first check which files changed after it (`git diff --stat <commit it records> HEAD`) and explain in plain words ([configure.md](configure.md), "Records outside the delivery folder").
- The trace files of the delivery exist, one per spec of the plan, made with `--delivery ENT-NNN`.
- Run `baco check-branch` before editing files and `baco plan-freshness ENT-NNN`.
- Every task marked `Parada humana: sim` has had its post-task stop answered ([implementation.md](implementation.md), section 3); one still unanswered blocks the delivery.
- Mobile end-to-end scenarios without a device in the session stay "automatizado, aguardando execução": only a CI result proves them; without CI they become a manual script here.

## 1A. Full battery, once

The external rounds ran on the task tests and the PR's CI quick battery ([review.md](review.md), section 2). Every test layer in every browser chosen for the project runs only now, once: after the last external verdict `aprovado` (with `ambos`, the person's), the current waiver, or the recorded exit-3 decision, and before the acceptance report. On `baco/ENT-NNN`, with nothing uncommitted, empty `.baco/junit/`, run the architecture's install command when the folder has no dependency folder or the manifest changed since its last install, then `baco run-tests --all`. It writes the battery stamp `.baco/logs/bateria-completa.json` (the commit it ran on, whether something was uncommitted, the seconds, each layer's result). In the Ratoeira, wait for it in the foreground ([implementation.md](implementation.md), section 10, "Ratoeira").
- Passed: re-run `baco trace` per spec ([review.md](review.md), section 3), so the traces carry the full run; only `docs/entregas/**` changes.
- A failure: read its part of the log in full. An unstable failure follows [implementation.md](implementation.md), section 6, "Unstable failure" (re-run only those tests without `--quick`, so the stamp records it). A real failure becomes a fix (an `INT-NN` task through [implementation.md](implementation.md), or ci-triage first when it is not plain where the error is), then a short delta round ([review.md](review.md), sections 3 to 6) and this battery again.
- Whether the stamp still holds is decided by `baco merge-check` (section 6), not by memory: when code changed after it, it ran with uncommitted changes, or the destination received something in between, run the battery again.
- Duration: when `baco merge-check` warns `battery.ci_timeout_near` (with `test_runs.ci_full: merge`, the battery takes more than 70% of the largest `timeout-minutes` of the CI workflows), tell the person in the end-of-run summary, with a recommendation: raise that timeout, split the full CI run into jobs, or switch `test_runs.ci_full` to `manual`.

## 2. Manual scenarios

The review path runs them first ([review.md](review.md), section 3), so their evidence is already committed before the trace and the verdict. Here only scenarios still `manual_pending` in the traces remain (for example the user could not run them yet, or the target is main, where pending ones block), including scenarios tied only to a business rule or requirement, without a CA (the trace's `otherScenarios`): they follow the same rule as the others.

**Specialist scenarios** (an `Automação` value that starts with `manual, especialista: <tipo>`, the kind one of `qa.specialist`, for example a screen reader test; without a kind only when the list has exactly one; any other marker is an ordinary manual scenario) are left to a specialist QA. Never ask the person to run them, and they never block any merge, main included: the trace flags them `specialist: true`, and the acceptance report lists them apart ("Fica com QA especialista", warning `merge.specialist_pending`). Record one row per scenario in `## Pendências` (the scenario, owner "QA especialista", destination, `aberta`). Never include them in chat summaries, messages or questions to the person (show them in chat only when the person explicitly asks); in the files, `progresso.md`, `aceite.md` (`## Fica com QA especialista`) and the PR body built from `aceite.md` keep them listed apart, as the engine already does.

**Out-of-scope criteria** (features not built in this delivery: marked `**Automação:** fora desta entrega` in QA, or cut out in `plano.md` via `**Fora desta entrega:**` or `fora desta entrega` in the `Tarefa` cell of `## Cobertura`, and approved at the `plan` gate via `baco approve-plan`) are listed in their own `## Fora desta entrega` section of `aceite.md`. Once approved in `aprovacao-plano.md` with no contradiction in `## Cobertura`, they never count as pending manual tests and never block a merge, main included; only real manual scenarios appear in `## Testes manuais`. Always list any criteria left out of this delivery in plain words in summaries to the person.

Guide the user through the other pending scenarios **one at a time**, in plain words:
1. Say which scenario it is, what it proves for the product, and read its numbered steps from the QA file ([cenarios-qa.md](../templates/pt-BR/cenarios-qa.md) shows the format). Ask where they will test (environment, device, browser). In the Ratoeira, offer once the preview link with login only for them ([architecture.md](architecture.md), "Preview for the owner"), and at the end of the delivery offer to take it down.
2. Ask the result: it worked (`aprovado`) or it did not (`reprovado`). Never record a result the user did not give, never mark one yourself, and never run a scenario "for" them unless an automated means really exists and you say so.
3. Record it:

```
baco qa-evidence docs/qa/cenarios-qa-spec-<nome>.md --ct CT-XYZ-001 --result aprovado --where "<onde testou, ex.: homologação, Chrome>" --delivery ENT-NNN
```

The row is added to the QA file's evidence table; the latest row per scenario wins, so a retest after a fix is a new row, never an edit. A `reprovado` is a real failure: tell the user plainly and route it to [implementation.md](implementation.md) (a fix task, never a loosened scenario).

Commit the evidence. A QA file is outside `docs/entregas/**`, so this commit makes the existing traces and verdict stale: re-run `baco trace` for every spec as in [review.md](review.md), section 3, and run a short delta round ([review.md](review.md), sections 3 to 6) before the report below. Record all scenarios in one batch to pay for one extra round, not one per scenario.

## 3. Acceptance report

```
baco acceptance-report ENT-NNN --target <branch> --trace docs/entregas/ENT-NNN-<slug>/revisao/trace-spec-<nome>.json [--trace <another spec>] [--qa docs/qa/cenarios-qa-spec-<nome>.md]
```

`--target` is the branch the delivery will merge into (its destination: `branches.integration` for the usual pull request, `branches.main` when `delivery.target` is `main`): the `manual_pending` rule of that branch decides whether a scenario without evidence blocks (default on main) or warns. Repeat `--trace` for each spec; `--qa` only supplies scenario titles for the checklist. It rewrites the tables of `aceite.md` every run and keeps the writer's text.

| Exit | Meaning | You do |
|---|---|---|
| 0 | merging is allowed | go on; read `warnings` and tell the user. Never merge while `merge.not_run` stands, even as a warning: fix it as in the table below |
| 1 | verification failure: a CA `failed` or unknown (`merge.failed`), a CA `uncovered` (`merge.uncovered`), no criteria (`merge.no_criteria`), or a scenario tied only to a rule or requirement failed or rejected (`merge.scenario_failed`) | fix it; never loosen a test. Code goes back to [implementation.md](implementation.md) and then through [review.md](review.md) again |
| 2 | human gate: any other blocker | read `data.blockers`; fix what is fixable (table below); what is left goes to the human |
| 64 / 65 | usage or environment (a delivery, plan or trace file missing or malformed) | fix the call or the setup |

| Blocker (message key) | Fixable by you |
|---|---|
| `merge.stale_trace` | yes, if only docs changed or you just recorded evidence: re-run `baco trace`. Code changed: [review.md](review.md) again. Never accepted |
| `merge.not_run` | an automated test did not run: fix the command (it must write its JUnit file) or the test, re-run the tests and the trace ([review.md](review.md), section 3). Never accepted |
| `merge.stale_verdict`, `merge.no_verdict`, `merge.verdict_not_approved` | a new review round ([review.md](review.md), section 6); `merge.no_verdict` is never accepted without a current waiver recorded by the human |
| `merge.trace_other_delivery` | re-run the trace with the right `--delivery` |
| `merge.no_plan_specs`, `merge.spec_not_traced` | fix the plan header or add the missing spec's trace |
| `merge.out_of_scope_unapproved`, `merge.out_of_scope_changed`, `merge.out_of_scope_gate_off`, `merge.plan_specs_changed`, `merge.plan_universe_shrank` | ask the human to approve the delivery cut portrait and record it with `baco approve-plan --by "<nome>"` (with `--replace` if `aprovacao-plano.md` already exists) |
| `merge.out_of_scope_contradiction` | fix the contradiction in `plano.md` / QA (exit 1: a CA cannot be both `fora desta entrega` and assigned to a `T-NNN` task in `## Cobertura`) |
| manual items pending for this target | run them with the user (section 2); under rule `block` they cannot be accepted instead. Specialist scenarios never count here |

Risks and agents in the report:
- The risks come from the open rows (any `Situação` that does not start with the word `resolvida`, in any case; a note after it, as in `resolvida (2026-11-13 17:36, teste passou)`, still closes the item) of the `## Pendências` table in `progresso.md`. The engine does not read free text: keep that table current as the work goes (a deferred decision, a known limit, a suggestion left for later), and before running the report check that every open item is a row. An item recorded only in prose is invisible and the report would say "nenhum risco".
- The `## Agentes` section comes from `custo.md`: record every role run with `baco cost add` so it is complete. Before running the report, measure the real usage of the delivery from the transcripts: `baco cost measure ENT-NNN --conductor-harness <harness> --write`, with your own harness, `claude-code` or `codex` (window from the plan's `**Início:**` line to now; exit 1 means no conversation was found: check the window and the folders it names, never write numbers by hand).
- With a current waiver of the external review ([review.md](review.md); `baco waive-review`), the report carries the warning `merge.review_waived` and says honestly that there was no external review, by whose decision, when and why. Repeat that in plain words when you present the report. `before_pr` and `merge_main` still ask the human as usual: the waiver replaces the verdict, never the approvals.
- A stale waiver (code changed after it) blocks with `merge.waiver_stale` (exit 2). Tell the user the waiver was for an older version of the code and ask them to record the decision again or to do the external review; never edit the waiver file by hand.

Do not change `manual_pending` in the config, the `--target`, or the traces' content to reach 0. If a blocker stays after the fixable ones are fixed, follow [gates.md](gates.md): the exit 2 text and its "acceptance-report exit 2" exception (per-blocker human decision, recorded in `progresso.md`; the merge approval in section 6 names it). Exit 1 is never accepted.

## 4. Fill the report for the user

Run the role [acceptance-validator](roles/acceptance-validator.md) first, with the path of `aceite.md`, the spec and QA paths and the trace files: it reads the body of each test behind a ✅ (not only its title), compares the assertions with the criterion (actor, operation, boundary, polarity, effect), runs the specific test in a scratch copy `.worktrees/copia-validador-NN` when the body leaves doubt or the trace does not show it ran, and reports per criterion what it read and ran. A report that names no test read for a ✅ is incomplete: send it back. Afterwards check `git status` (only its report changed) and remove the copy (`git worktree remove --force .worktrees/copia-validador-NN`). Fix the weak links before presenting.

Then run the role [writer](roles/writer.md) to fill the `<!-- preencher: redator -->` slot with **"O que muda para o usuário"**: plain business pt-BR, from the specs and the delivered behavior, one short paragraph or a few bullets, without file names, test names or jargon; nothing the evidence does not support. When the plan has a `Se der errado` section, give it to the writer too: the report repeats it in business words. Re-running `acceptance-report` keeps the writer's text, so run the writer once, after the data it describes is settled; call it again only if that data changed (criteria, delivered behavior, `Se der errado`). Record both runs with `baco cost add ENT-NNN --phase 8 --agent <role> --model <m> --effort <e>`.

Commit `aceite.md` and the traces (only `docs/entregas/**`, so nothing goes stale).

Once the report is final, offer the business test script (section 4b) with one plain question: "Alguém de negócio vai testar esta entrega? Posso preparar um roteiro simples para essa pessoa." It is optional: on a "não", go on.

## 4b. Business test script (optional)

Never mandatory, and it replaces neither the automated tests nor the reviews. Offered after the report (section 4) and available at any time through the command `/baco:roteiro-negocio ENT-NNN`. It is for a non-technical tester (business area, client, key user).

Draft it with the role [writer](roles/writer.md) (the same plain voice as "O que muda para o usuário"), from the approved specs, the delivery's QA scenarios and the report. Save it as `docs/entregas/ENT-NNN-<slug>/roteiro-teste-negocio.md`, from [roteiro-teste-negocio.md](../templates/pt-BR/roteiro-teste-negocio.md), and commit it (only `docs/entregas/**`). Business rules only, as in the spec: no file, screen-internal or implementation detail. Content, in the tester's words:
1. What changed or was created.
2. The rules and limits (what is allowed, what is refused).
3. How to access: address, test user, sample data. Ask the human; never invent or write a real password.
4. Step by step per test, translated from the Dado/Quando/Então of the QA scenarios of the delivery's CAs: what to do and what should happen. One test per scenario, keeping its `CT-ID`.
5. What is NOT part of this delivery, so it is not reported as a defect.
6. How to answer: a simple sheet, one line per test: `CT-ID | funcionou / não funcionou / dúvida | comentário`.

Reading the answers back (the user pastes or sends the sheet). Record only what the sheet says:
- `funcionou`: `baco qa-evidence <qa.md> --ct <CT> --result aprovado --where "teste de negócio: <nome>" --delivery ENT-NNN`.
- `não funcionou`: the same with `--result reprovado`. It is a real finding: tell the human plainly and route a correction (a FIX or INT task) through [implementation.md](implementation.md); the human decides what happens next. Never loosen a scenario.
- `dúvida`: a row in the `## Pendências` table of `progresso.md`, with the comment, until someone answers.

New evidence is a QA-file commit, so it makes traces and verdict stale: handle it as in section 2.

## 5. Pull request and CI (project on GitHub)

1. Gate `before_pr` (on by default): show the user the report in plain words (what works, what is pending, risks, what changes for them) and ask for the approval sentence of [gates.md](gates.md). Wait for an explicit "sim". Not asked when `delivery.integration_merge` is `auto`, the destination is the integration branch and `baco merge-check` exited 0 ("Ready to test" above).
2. Check `gh auth status`. Push `baco/ENT-NNN`. The draft PR **from `baco/ENT-NNN` to the destination** normally exists already ([review.md](review.md), section 3): replace its body with the `aceite.md` text, adding a `Closes #N` line for each issue recorded in the task files, and mark it ready. When it does not exist (the review ran in another mode, or GitHub came later), open it with that body:

```
gh pr edit <number> --body-file .baco/logs/pr-body-ENT-NNN.md
gh pr ready <number>
gh pr create --base <destination> --head baco/ENT-NNN --title "ENT-NNN | <nome da entrega>" --body-file .baco/logs/pr-body-ENT-NNN.md
```

Write the PR body file under `.baco/logs/` (git-ignored, inside the project), never in a session temporary folder outside the project.

3. CI must be green. Follow it in the background (for example a single background `gh pr checks <number> --watch` with a timeout, never repeated foreground `gh run watch` loops that burn turns and context). The workflow comes from [ci-github-actions.yml](../templates/pt-BR/ci-github-actions.yml) (JUnit into `.baco/junit/`, uploaded as an artifact; a change only to `.md` files does not run it). What it runs follows `test_runs.ci_full`: `merge` (the default) runs the quick battery on the PR and the full one on the merge into the integration branch; `manual` runs the quick one on the PR and on that merge (which publishes), and the full one only by hand (`workflow_dispatch`, section 6b). A broken test blocks the merge.
4. On a red CI run, save the failed log to `.baco/logs/ci-failed-<run-id>.log` (never dump the whole log into the conductor's context) and run the role [ci-triage](roles/ci-triage.md) with that file path. It decides whether the error is in the **code**, in the **test** or in the **environment** (missing secret, outdated cache, runner trouble). Code: a fix task `CI-01`, `CI-02`, … through [implementation.md](implementation.md). Test marked `instável` (it passed when only it re-ran on the same code): a pending item, no task ([implementation.md](implementation.md), section 6, "Unstable failure"). Environment: say so and re-run once; never hide it with a skip. A test is changed only when the spec changed it ([spec-change.md](spec-change.md)); otherwise it is never weakened, skipped or deleted, and `baco guard-tests` stays in force.
5. Any code commit after the verdict makes it stale: after a CI fix repeat [review.md](review.md), sections 3 to 6 (a delta round), the full battery when `baco merge-check` says its stamp no longer holds (section 1A), then section 3 here again, and update the PR body with the new `aceite.md`.
6. Without a GitHub remote or a working `gh` login: use the local mode below and give the user the exact manual steps if they want a PR on their own.

## 5b. Local mode (no GitHub)

Same gates, same engine. The full battery of section 1A, `baco run-tests --all`, is the "CI" (never the raw commands: the engine adds `.baco/local.env` and queues browser batteries; JUnit goes into `.baco/junit/`). Do sections 2 to 4, ask `before_pr` approval to bring the delivery to the target, then section 6 merges locally; `baco merge-check` runs without `--pr`, so its `ci` condition stays not ok and the integration merge always asks. The report stays in `aceite.md`.

## 6. Merge

Before any merge, run `baco merge-check ENT-NNN --target <branch> [--pr <number>]`. It checks the battery stamp (after fetching the destination from `origin` when there is one: a failed fetch is not ok), the verdict (with `review.pr.reviewer: ambos`, the latest `aprovado` must be the person's; a recorded exit-3 decision is not ok under `delivery.integration_merge: auto`, because that merge is decided with the person, per blocker, [gates.md](gates.md)), the manual scenarios under `block` (with current traces), what the acceptance report would decide for that destination (`acceptance`: criteria failed or uncovered, stale traces, a plan spec not traced, a trace of another delivery, or an automated test left not run, are not ok), `## Esperando a pessoa` (a missing `progresso.md` or a section it cannot read is not ok), the PR's CI (the PR open and into that destination) and the policy. Fix what is yours to fix (a stamp that no longer holds: section 1A again; CI still running: wait), and tell the person in plain words each condition left.

Merging into `branches.main` always needs the human's explicit approval: `merge_main` can never be off, in any layer, even when the user said "run straight through" ([gates.md](gates.md)). Ask for the approval sentence naming the target branch, the report result, the CI state and any accepted blockers; a green CI, a clean report, an `aprovado` verdict, a `baco merge-check` exit 0 and your recommendation are inputs, not approval. For the integration branch also ask for a plain "posso juntar?" and wait for a "sim", except with `delivery.integration_merge: auto` and `baco merge-check` exit 0, when you merge without asking ("Ready to test" above) and record it under `Decisões registradas` ("junção automática na integração: merge-check saída 0", date from `date`).

When the human approves (or the automatic integration merge above applies):
- GitHub, automatic integration merge (`delivery.integration_merge: auto`): run `baco merge-check ENT-NNN --target <integration> --pr <number> --apply`, which checks every condition, runs `gh pr merge <number> --merge` without `--delete-branch`, fetches the target and syncs the GitHub Project board automatically.
- GitHub, human-approved merge (main, or integration with `ask`): `gh pr merge <number> --merge` as a merge commit (no squash or rebase, so the engine can prove the branches merged), and **without** `--delete-branch`: the cleanup below tags the delivery before deleting.
- Local: from a clean checkout of the target, `git merge --no-ff baco/ENT-NNN`.
- If the project later promotes from integration to main, follow section 6b.

Then update the local target branch (`git fetch`, fast-forward only). With `github.project` set, sync the board now (`baco board ENT-NNN --apply`, [implementation.md](implementation.md), section 10, "Project board"): `baco board ENT-NNN` sees the delivery in the integration branch (local or `origin/<integration>`) and moves the parent issue, and any task still behind, to `merged`; a failure is a pending item, never a reason to hold the merge. Never record the approval anywhere that touches a protected branch: it goes into `progresso.md` with the post-merge documents ([reconciliation.md](reconciliation.md)): date, target, who approved, accepted blockers. Note the merge for the catalog: later `git rev-parse entrega/ENT-NNN` gives its sha once cleanup tagged it; before that, the merge commit.

## 6b. Promotion from integration to main

1. **Early check.** Before the integration merge, on `baco/ENT-NNN` while traces and verdict are current, also run section 3 with `--target <main>`. It only reports what main's rules would block (for example manual scenarios pending under `block`), so the user can run them now (section 2). Then run section 3 again with `--target <integration>`: each run rewrites `aceite.md`, and the integration merge uses that one.
2. **Promotion branch.** After the integration merge, cut `baco/ENT-NNN-PROMO` from the integration tip (`git switch -c baco/ENT-NNN-PROMO <integration>`). On it: record and commit the manual evidence main still needs (section 2), re-run `baco trace` per spec with `--delivery ENT-NNN` ([review.md](review.md), section 3), then section 3 here with `--target <main>`.
3. **`merge.stale_verdict` is expected**: the integration tip carries code the verdict did not review. Handle it explicitly: a delta external round on the promotion branch ([review.md](review.md), sections 3 to 6), or the human's per-blocker decision ([gates.md](gates.md)). Never pass it silently.
4. With `test_runs.ci_full: manual`, the full CI has not run on what main will receive: recommend running it by hand on the integration branch before this step (`gh workflow run <workflow file> --ref <integration>`, then `gh run watch`), and say so in the `merge_main` question when the person declines.
5. Open the PR (or merge locally) from `baco/ENT-NNN-PROMO` to `<main>` as in sections 5 and 6, with the `merge_main` approval.
6. After the merge into main, `baco cleanup-branches` (section 7) lists `baco/ENT-NNN-PROMO` like any other merged branch (merged into main or into the integration branch).

## 7. Cleanup

Switch to the target branch first (the engine never deletes the current branch). Then run:

```
baco cleanup-branches
```

The default is a dry run: it lists merged task branches (`baco/ENT-NNN-<TASK-ID>`), the merged delivery branch, the merged promotion branch (`baco/ENT-NNN-PROMO`), merged `docs/*` branches, their worktrees, empty loose folders in `.worktrees/`, any non-empty loose folders left in `.worktrees/` (which are never deleted, only shown for the person to inspect), closed delivery logs in `.baco/logs/`, and, with `--remote`, what would happen on the remote. Separate merged branches from loose folders when showing the list in plain words (say which branches are already merged, and name any empty or skipped non-empty loose folders in `.worktrees/` separately, never calling loose folders "rascunhos já juntados"), and ask for confirmation. After a "sim":

```
baco cleanup-branches --apply [--remote]
```

`--apply` removes only what dry run showed: it re-checks each branch, deletes one by one only known 0-byte untracked sandbox mount stubs in its worktree and removes the worktree without `--force`, removes ONLY empty loose folders in `.worktrees/` (never deleting any non-empty loose folder, whether it has a `.git` repo, local commits, loose files or ignored files), tags the delivery as `entrega/ENT-NNN`, deletes the branch and removes `.baco/logs/` entries planned for the closed delivery (keeping shared project logs like `harnesses.md`, `uso-ferramentas.jsonl` and `cleanup-commands.sha256`). Add `--remote` only if the user also wants them removed from the remote. It never touches protected branches, the current branch or anything not merged. Exit 1: tell the user which ones were kept and why (for example a remote branch with newer work is kept); never force-delete. A squash or rebase merge usually does not register as merged, so the branches are kept: say so and ask what to do. If `.baco/config.yaml` declares `cleanup.commands` (BACO never decides on its own what else is disposable, such as test databases or container images), compare the SHA-256 hash of the configured `cleanup.commands` list with `.baco/logs/cleanup-commands.sha256` (git-ignored, kept across deliveries): when the file is missing or the hash differs, show the commands to the person first, record the new hash in `.baco/logs/cleanup-commands.sha256` and run them; when the hash matches, run them at closeout without asking again. The engine checks merges into the integration branch only, so a delivery merged straight into the main branch is kept; tell the user:

> Esta entrega foi juntada direto na branch principal, então a limpeza automática não a remove. Posso apagar esses rascunhos de trabalho à mão, um por um, se você confirmar. Quer que eu apague?

## 8. Closing the phase

Tell the user in plain pt-BR what was delivered, which criteria were left out of this delivery (`fora desta entrega`, always listed in plain words whenever any exist), what stayed pending (never citing a pending item by ID or number alone: explain each one in plain words right in the report, keeping specialist QA scenarios out of chat reports and summaries) and the PR or merge state, with each reviewer's model and effort in the table, separating **proposto**, **alterado** and **verificado** (the engine's exit 0 and CI are verification). Next phase: [reconciliation.md](reconciliation.md); the catalog changes only there.
