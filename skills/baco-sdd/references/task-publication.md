# Phase 5: Publish tasks

Output: one record per task of the approved plan, in each adapter listed in `tracker` of `.baco/config.yaml`. Gate: `task_batch` (see [gates.md](gates.md)). Load this reference after the plan of a delivery is approved ([planning.md](planning.md)) and the user wants the work released. Also load [common-process.md](common-process.md) for the reconciliation gate (step 5).

Roles named below are subagents when the host has them; otherwise run the role inline in the session. Run the role [publisher](roles/publisher.md) for the preparation, the writing and the read-back; you present the batch and run the gate.

Approving a spec, approving a plan or looking at existing issues is **not** approval to publish. A recommendation never counts as approval.

## Entry conditions

1. The plan is approved (recorded in `progresso.md`) and fresh: run `baco plan-freshness ENT-NNN`. On exit 1, go back to [planning.md](planning.md) ("Re-planning"); never publish a stale plan.
2. The plan is not exploratory and its baseline, when incremental, is proven. Otherwise do not publish it as a definitive plan.
3. Run `baco check-branch`; on exit 1 switch to the delivery branch `baco/ENT-NNN` before writing files.
4. Do not choose a service, repository, project or board that does not exist. Discover what is **really available and authorized** in the environment and its real capabilities, fields, permissions and limits. The method does not depend on any one provider.

## The neutral task contract

Every task, in every adapter, carries the same content. Adapt it to the destination's native fields; invent no values.

- **Title and outcome:** the single, verifiable behavior or delivery; never a generic layer name.
- **Description:** context, what is included and excluded, the approved spec, its version and cut, and the RF/RN/INV/CA/QA IDs with a real semantic link.
- **Done criteria:** observable conditions and results, including relevant negative and limit cases, without claiming that QA ran.
- **Relations:** predecessors, blockers, sub-items, parent delivery, and destinations; only when they have value and the provider supports them.
- **Tests:** `Testes da tarefa`: the tests that run while building it (its own plus the existing tests of the files it touches, quick form).
- **Metadata:** class, level/effort, lane, likely files (both copied from the plan row), branch, human stop and, where the provider has them, labels, priority, owner, milestone, status. Relative size is not priority and is not a deadline.

Do not copy the whole contract into each task. Reference the canonical source (spec, plan) and copy only what is needed to execute and verify. A single task needs no artificial hierarchy.

## Adapters

The adapter comes from `tracker`: a list, default `files`. Write to every adapter in the list. The contract allows new adapters without touching the core: each one only needs to find an existing task, create one, link, read back and update status.

**`files` (always active; the source of truth).** For each plan task write `docs/entregas/ENT-NNN-<slug>/tarefas/<TASK-ID>.md` from [tarefa.md](../templates/pt-BR/tarefa.md), with the values of the plan row: CAs, class, level/effort, lane (`Faixa`), likely files (`Arquivos prováveis`), `Testes da tarefa`, branch `baco/ENT-NNN-<TASK-ID>`, dependencies, `Parada humana`, `Parte` (only with the back-end and front-end split), expected result, done criterion, interfaces. Expected result, done criterion and `Testes da tarefa` come from the task's subsection of `Detalhes das tarefas` in the plan; what the plan does not give is written `a definir pelo implementador`, never invented. The task ID is the plan's ID; never renumber. The engine also puts `FIX-NN.md` files in that folder; leave them alone.

**`github` (when listed; through `gh`).**
1. Check `gh auth status` and that the repository comes from the git remote. Without a working login, use the manual batch below.
2. The delivery becomes a **parent issue** titled `ENT-NNN | <delivery name>`, body with the plan summary and the path of `plano.md`. Each task becomes an issue titled `ENT-NNN <TASK-ID> | <title>`, created with `gh issue create --title ... --body ...`, and linked as a **sub-issue** of the parent. Create the relation with `gh api` on the sub-issues endpoint of the parent, using the issue's internal id (`gh api repos/<owner>/<repo>/issues/<number> --jq .id`), not its visible number. If sub-issues are unavailable, list the tasks as a checklist (`- [ ] #<number>`) in the parent body and report that limitation.
3. Use only labels and milestones that already exist (`gh label list`); create none without authorization. The body states the outcome, CAs, done criteria and the repository path of the task file; the file stays canonical.
4. After creating, record the mapping: the issue URL as a new row `| Issue | <url> |` in the task file's table, and the parent URL in `progresso.md` as the line `- **Issue mãe:** <url>` right under its title (the engine reads it there), also noted under `Decisões registradas`.
5. **Project board**, when `github.project` is set ("Project board" below): add the parent and every task issue to the board and set each one's column to the `published` option.

**One-way sync: the files are the source of truth** (the task files and `progresso.md`). GitHub only receives the publication and then status updates: the board column when `github.project` is set, otherwise a comment or label as the project uses. Closing comes from the PR of the delivery (`Closes #N`), not from hand-editing issues. If an issue or a board card differs from its file, **the file wins**: report the divergence and never copy issue text back into the file or derive a task's state from the issue or the board.

### Project board (`github.project`)

A GitHub Project board mirrors the delivery, one way: the conductor moves each card when its task changes, and nothing ever reads the board to decide a state. The columns are the options of the board's single-select field (`github.project.field`, default `Status`), one per moment (`github.project.status`): `published` (default `Backlog`), `started` (`In progress`), `review` (`In review`) and `merged` (`Done`). The login needs the `project` scope ([configure.md](configure.md), question 2B).

**What goes where is the engine's answer, never yours.** `baco board ENT-NNN` reads the task files (`| Issue |` rows), the `Issue mãe` line and `progresso.md`, and lists each issue whose column must change, with the exact command. A task in `Tarefas em andamento` is `started` (building, a fix round) or `review` (its review, or waiting for the person's check); out of the table, its last row in `Registro das tarefas` makes it `merged` (`FEITO`, `FEITO_COM_RESSALVAS`) or `started` (any other state); with neither, `published`. The parent is `started` once phase 6 begins (Retomada filled, or any task started) and `merged` only when the delivery branch (or its `entrega/ENT-NNN` tag) is in the integration branch; then every task is `merged` too.

**At publication**, after the issues are created and read back (the publisher does steps 1 and 2; you do step 3, after writing the `Issue mãe` line):

1. Add each issue (the parent included) with `gh project item-add <number> --owner <owner> --url <issue-url>`. Adding an issue already on the board changes nothing, so a retry is safe.
2. Read it back: `gh project item-list <number> --owner <owner> --format json --limit <enough>` lists the issue's URL among the items.
3. Run `baco board ENT-NNN` and run each command it lists (they set `published`). After each one, read the card back (same `item-list`, the item's field value) and record it: `baco board ENT-NNN --applied "<issue-url>=<column>"`. The record lives in `.baco/logs/` (not versioned); when it is lost, the next run lists everything again, which is harmless.

The command it lists sets the column by name (`gh project item-edit <number> --owner <owner> --url <issue-url> --field "<field>" --value "<column>"`). When the installed `gh` does not have `--field` and `--value` (`gh project item-edit --help`), use the ids: `gh project view <number> --owner <owner> --format json --jq .id` (project id), `gh project field-list <number> --owner <owner> --format json` (the field's `id` and the option's `id` by name), the item id from `gh project item-add ... --format json --jq .id`, then `gh project item-edit --id <item> --project-id <project> --field-id <field> --single-select-option-id <option>`.

**A board failure never stops the delivery.** Without the `project` scope, with a board, field or option that does not exist, or any other `gh project` error: do not retry blindly and do not get around it (no other token, no other tool). Record one row in `## Pendências` of `progresso.md` (what failed, "o quadro do GitHub não acompanha a entrega", owner the person, the command to re-run, `aberta`), tell the person in one plain line, and go on. Missing scope: say to run `gh auth refresh -s project`. Once fixed, `baco board ENT-NNN --all` lists every card again and the pending row is closed as `resolvida`.

## Prepare and approve the batch

1. **Check the destination structure:** repositories, templates, labels, statuses, hierarchies, required fields, owners. Respect what the tool supports; do not oblige features that are absent.
2. **Search for existing tasks** by semantics, scope and origin, closed ones included: task files of the delivery, and for `github` `gh issue list --state all --search "ENT-NNN in:title"`. Reuse, link or flag equivalents and keep IDs and history. Never open a parallel backlog for the same delivery.
3. **Build the complete batch:** new tasks, reuse, changes and relations, with destinations and effects, and unresolved fields and publication risks.
4. **Present it** in plain pt-BR as a short table (tarefa, o que entrega, depende de, parada para você conferir, onde será criada, nova ou já existente). Then ask for the gate and wait:

> Para eu seguir, preciso da sua aprovação sobre: criar estas [N] tarefas da entrega [nome] em [onde]. Resumo: [2 a 3 linhas, incluindo se algo já existia]. Você aprova? (sim / quero mudar algo)

5. **Wait for an explicit "sim" on the whole batch** before the first creation, change or link. One approval covers the operations shown; do not ask one by one unless there is new scope or a relevant decision. Never add an item outside the approved batch. With `gates.task_batch` set to `off` in the config the stop is skipped, but the batch is still built, written, read back and reported.
6. Record the approval (date, who, the batch) in `progresso.md`, under `Decisões registradas`. Never record one that did not happen.

## Idempotent writing and partial failure

- **Before writing**, revalidate the destination, equivalent tasks and that the approved batch still matches the current state. Duplicates come from different titles and blind retries.
- Use the native ids the API needs for relations; do not confuse a readable issue number with an internal id. With no native link, say so and use a textual reference only when authorized.
- A task file that already exists is never overwritten silently: compare it with the plan row, keep human edits, and report differences.
- **After each write, read the record back** and check the relevant fields and relations: re-read the file, `gh issue view <number> --json title,body,labels,state` and the parent's sub-issues. A positive API answer does not prove that the creation, change or link persisted.
- On an error or timeout with an ambiguous result, **query the existing state before resending**. Separate what is confirmed, pending verification, not done, and failed; resume only the rest, keeping the ids already created.
- Never claim permanent deletion because an issue was closed or removed from a board. Never delete and recreate in bulk to repair a broken relation.

## Manual batch

When `gh` is missing, has no login, or the permission to write is denied, or the provider has no usable tool: deliver a **batch ready for manual publication** and do not simulate created records. For `github` give, per task, the title, the body in a fenced block and the exact `gh issue create` command, with the destination marked as unconfirmed. Every such item stays `proposto`, never `publicado`. The `files` adapter still runs, since it only writes local files. Tell the user in plain words what they must do:

> Não consegui criar os cards (itens de acompanhamento) no GitHub daqui, porque [motivo em palavras simples]. Deixei tudo pronto para você publicar: [onde está]. As tarefas já estão registradas nos arquivos da entrega, e é por elas que eu sigo. Quando publicar, me avise para eu conferir.

## Output and state

Report each batch item as one of: **proposto**, **aprovado para publicação**, **publicado e verificado**, **publicado não verificado**, **não publicado**, **falhou**, with the returned link or id when proven. With a board, also report each card as added and in its column, or the board failure recorded in `## Pendências`. Include verified relations, duplicates avoided, blockers, unavailable tools, and the exact step to resume a partial failure.

Commit the task files and `progresso.md` on `baco/ENT-NNN`: task branches start from its tip, so implementation needs them committed.

Then reconcile only the **planning documents and delivery records** you may write (`plano.md`, `progresso.md`, task files), by the gate of [common-process.md](common-process.md), step 5. Never change a normative rule of the spec because of an issue or a provider limit, and never say the documents are in sync without re-reading the result. Next phase: `implementation.md`.
