# Gates and autonomy

Load this reference when a phase reaches a human approval point, when the engine exits with code 2 or 3, or when the user changes how much you may do alone. Gates are where work stops and waits for a person.

## Default: level 2

The routine approvals are (the table below is authoritative):
- the spec (`spec_approval`)
- the architecture (`architecture`)
- the plan (`plan`)
- the task batch (`task_batch`)
- the pull request (`before_pr`, then `merge_main` for the merge itself)

From the approved plan on, execution is autonomous ([implementation.md](implementation.md), section 7): tasks, the internal reviews, the review of the delivery's PR by an agent (with its fix rounds when `review.pr.auto_fix` is on) and the acceptance report run on their own until the delivery is ready for the person to test, and the run stops when the review waits for a person or earlier only when there is no way around (a never-off gate is next and nothing else can move, or everything left depends on something blocked). After each task there is no stop (`each_task` is off by default; the human may turn it on). The human can say "pare" at any time.

| Gate key | Stops before | Default | Can be turned off |
|---|---|---|---|
| `project_start` | starting a new project | on | yes |
| `spec_approval` | a spec counts as approved | on | never |
| `architecture` | following the proposed architecture | on | yes |
| `plan` | executing the delivery plan | on | yes |
| `task_batch` | releasing the task batch | on | yes |
| `each_task` | moving past each finished task | off | yes (turning it on adds stops) |
| `before_pr` | marking the delivery's pull request ready to merge (the draft opened for the review in phase 7 is not a request to merge) | on | yes |
| `irreversible_action` | an action that cannot be undone | on | never |
| `merge_main` | merging into the main branch | on | never |

## Three layers, most specific wins

1. Skill default (the table above).
2. Project configuration: `gates:` in `.baco/config.yaml` (see `configure.md`).
3. Request of this run, for example "nesta entrega, rode direto até o PR". It applies only to the current delivery and is not written to the config.

A plan may also mark a risky task with `Parada humana: sim` (the planning phase defines the marker). That task is built and reviewed, then waits for the human check before it is merged; independent tasks keep going; tasks that depend on it wait; if all that remains depends on it, the run stops and says so ([implementation.md](implementation.md), section 3). The check applies on top of any layer, even when `each_task` is off, and even under a "run straight through" request.

In the same way, a reversible product doubt proceeds with your recommendation, recorded in `progresso.md` as "decidido pelo agente, conferir no fim"; an environment block becomes a pending item and the work continues; contested or escalated review findings ([review-protocol.md](review-protocol.md)) go to the end-of-run summary. That one summary lists everything waiting for the human ([implementation.md](implementation.md), section 11).

## Never off

`spec_approval`, `irreversible_action` and `merge_main` stay on whatever any layer says. If config or the user says "off" for them, keep them on and say so in plain words:

> Essa parada eu não consigo desligar: ela protege você de erro sem volta. Posso desligar as outras (como a de cada tarefa).

Irreversible actions are: destructive migration, data deletion, production deploy. Before any of them, stop, say exactly what will be lost or changed and whether it can be restored, and wait for an explicit "sim". In autonomous execution they are never done alone: they are queued for the end-of-run summary, and the work that does not depend on them goes on. The rule for merging into main is configurable (for example how a pending manual scenario is treated, `manual_pending`), but the human approval of the merge is not.

## A recommendation never counts as approval

Your own recommendation, a green test run, a clean review, an `aprovado` verdict from an external reviewer (an agent's verdict imported without the person included) and a decision confirmed in the chat are all inputs. None of them is approval. Approval is an explicit statement by the human, about the specific thing, after seeing it. Silence, "ok" to something else, or "pode seguir" given before you presented the item do not count. When unsure, ask again, naming the item.

Approval sentence to ask for (adapt the item):

> Para eu seguir, preciso da sua aprovação sobre: [o que está sendo aprovado]. Resumo: [2 a 3 linhas]. Você aprova? (sim / quero mudar algo)

Record the approval where the phase says (catalog state, plan header, `progresso.md`). Never record one that did not happen.

## Reading engine exit codes 2 and 3

| Code | Meaning | You do |
|---|---|---|
| 0 | ok | continue |
| 1 | verification failed | fix it, or report it plainly; never bypass |
| 2 | human gate required | stop; ask the human |
| 3 | human decision required (review loop limit) | stop; ask the human |
| 64 / 65 | usage or environment error | fix the call or the setup; tell the user only if you cannot |

Codes 2 and 3 are not errors to work around. In autonomous execution, the item that got them waits for the human and goes to the end-of-run summary; independent work goes on ([implementation.md](implementation.md), section 7). Do not retry with other flags, edit the config, allow-list findings on your own, or change the target branch to get a 0. Read the engine's message keys (they say what blocked), then speak to the human.

Code 2 (for example `guard-tests` found changes to tested scenarios, or `acceptance-report` blocked the merge):

> Parei aqui porque preciso de uma decisão sua. [O que o motor encontrou, em palavras simples.] Opções: [A: o que acontece], [B: o que acontece]. Minha recomendação é [X], mas a decisão é sua.

Code 3 (the external review loop reached `review.external_rounds_max`; every imported verdict counts, from an agent or a person, and the automatic fix rounds stop here):

> A revisão externa já deu [N] voltas e ainda não foi aprovada. Para não ficar em círculo, preciso que você decida: [A: seguir mesmo assim com os pontos abertos], [B: mudar a spec ou o plano], [C: parar a entrega]. O que prefere?

If the human chooses A, record it in `progresso.md` (date, round, open findings, who decided). Delivery may then start without an `aprovado` verdict ([delivery.md](delivery.md), section 1), and the resulting `merge.verdict_not_approved` is still decided per blocker, as in the `acceptance-report` case below.

Rules for both:
- Translate engine finding codes into plain pt-BR consequences ("um teste que prova um critério da spec foi alterado", not `TAGGED_TEST_CHANGED`).
- Give the options and a recommendation; the user's answer is the decision. If the user allows a guard-tests finding, pass it with the engine's `--allow` flags and note the decision in `progresso.md`. A `SKIP_ADDED` finding (a skip or only marker) has no ID, so it can never be allowed: revert the marker.
- After the human answers, re-run the same command; continue only on 0, except for the two cases below.

Special case: `CONFIG_TESTS_CHANGED` (the `tests` section, the `tests_quick` section or `app.smoke` of `.baco/config.yaml` changed) and `CONFIG_PROVENANCE_CHANGED` (the `provenance.ignore` list changed: files that would no longer count as code). Both follow the steps below. `--allow` cannot clear it, so `guard-tests` keeps exiting 2 for that diff. Handle it only when it is the ONLY finding code left; every other code must still clear to exit 0 first.
1. Show the human what changed in the test settings, in plain pt-BR (which test commands, quick test commands, the start-the-app command or test-file patterns were added, removed or altered, and the risk: tests may stop being checked).

> Mudou a configuração dos testes: [o que mudou, em palavras simples]. Isso pode fazer alguns testes deixarem de ser conferidos. Você aprova essa mudança? (sim / não)

2. If the human explicitly approves (a clear "sim", not silence): record in the delivery's `progresso.md` the date, the finding (`CONFIG_TESTS_CHANGED` or `CONFIG_PROVENANCE_CHANGED`) and who approved, then proceed for that finding only. The exit stays 2; that one recorded approval is the legal way past it.
3. If the human does not approve: revert the change to `tests`, `tests_quick` and `app.smoke` in `.baco/config.yaml`, re-run `guard-tests` and continue only on 0.

Special case: `acceptance-report` exit 2. Its blockers other than a failure (exit 1 is never accepted) may be accepted by an explicit human decision **per blocker**, after you fixed everything fixable ([delivery.md](delivery.md), section 3). Show each remaining blocker in plain pt-BR, with what it risks, and ask about it separately; one "sim" never covers several. Record in the delivery's `progresso.md`, for each accepted blocker: date, blocker (message key), who decided. The exit stays 2; the recorded decision is the legal way past it, and the merge approval must name it. Never accepted: `merge.no_verdict` without a recorded waiver (only the human waives the external review, with `baco waive-review`, [review.md](review.md), section 4; a current waiver turns the blocker into the warning `merge.review_waived`, and a stale one, `merge.waiver_stale`, needs the human's decision again); `merge.stale_trace` (re-tracing is mechanical: re-run `baco trace`); `merge.not_run` (an automated test that did not run proves nothing, whatever the rule; fix the command or test and re-run); a manual scenario still pending under rule `block` for the target branch (it must be executed and its evidence recorded). Never edit `manual_pending`, `--target` or a trace to reach 0.

## Branch protection

Protected branches (`branches.protected`, default main, master, develop) are never edited directly. Before editing files, run `baco check-branch`; on exit 1 create or switch to the delivery or task branch first, or to `docs/<nome>` for document work outside a delivery (phases 1 to 3). When the host has a hook that blocks writes on protected branches, it coexists with this rule; never rely on the hook alone.
