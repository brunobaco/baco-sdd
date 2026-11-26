# Phase 3: Architecture

Output: `docs/arquitetura/README.md` (from [arquitetura.md](../templates/pt-BR/arquitetura.md)) and one ADR per important choice in `docs/arquitetura/adr/ADR-NNN-<slug>.md` (from [adr.md](../templates/pt-BR/adr.md)), plus the test commands in `.baco/config.yaml`. In mode `Audit`, output is only the read-only report `.baco/logs/revisoes/arquitetura-auditoria-NN.md`. Gate: `architecture` (see [gates.md](gates.md); none for `Audit`). Load this reference when approved specs exist and no architecture is approved yet, when the user brings a stack to check, when a new spec pressures the current architecture, or to audit an existing codebase. Also load [common-process.md](common-process.md), and load [architecture-audit.md](architecture-audit.md) whenever the repository already has code (`Validate`, `Revisit`, `Audit`) or a live system needs a transition or performance plan.

Roles named below are subagents when the host has them; otherwise run the role inline in the session. The role [architect](roles/architect.md) can do the factor extraction (step 1) and the drafts of the stack, the ADRs and the test commands (Suggest or Validate). It writes its short report (the factors, the stack, the test commands, the open risks) to the path you name, usually `.baco/logs/revisoes/architect-NN.md`, and writes each draft ADR as its own file in `docs/arquitetura/adr/` (status `Proposta`) and the draft `docs/arquitetura/README.md` itself, so you do not transcribe them; it returns a short summary and the report path. It never touches `.baco/config.yaml`, existing accepted ADRs or anything else, and never commits. Read the report and review the files, then run `git status`: only the report, the new draft ADR files and the README draft may have changed, anything else is reverted and becomes a finding (SKILL.md, "Roles"). You fill the test commands in `.baco/config.yaml`, send the proposal through the devil's advocate and run the gate.

The user may not have coded in years and relies on you for the stack. Every explanation to the user is plain pt-BR in business language: say what a choice means for time, risk and money, and put any technical term next to a short explanation. Never ask the user to pick a technology without a recommendation.

## When it runs

- After the first set of approved specs, typically the first phase of the roadmap in `planejamento-do-produto.md`. Read only approved specs (state `Aprovada` in the catalog). Do not design from drafts.
- Again when a new or changed spec pressures the architecture (see Revisit).
- In mode `Audit` (`auditar arquitetura`), on any repository that already has code, even without approved specs or a working branch (it is read-only and writes only `.baco/logs/revisoes/arquitetura-auditoria-NN.md`).
- Before editing project files (`Suggest`, `Validate`, `Revisit`), run `baco check-branch`; on exit 1 switch to a working branch first (see `gates.md`, "Branch protection").

## Choose the mode

If the user did not say, ask once:

> Você já tem uma tecnologia escolhida para o projeto, ou prefere que eu proponha uma? (a) proponha para mim; (b) já tenho uma e quero que você confira se serve.

(a) is Suggest; (b) is Validate. If the user asks to audit an existing codebase's architecture ("auditar arquitetura"), run **Mode Audit** (below). If `docs/arquitetura/README.md` (or the project's own architecture document) already exists and the user is not asking for an audit, read it and treat the request as Revisit.

## Step 1: Extract the decision factors

Read the approved specs and the vision. When the repository already has code (`Validate` or `Revisit`), also discover the real running state from the code first ([architecture-audit.md](architecture-audit.md), section 1). List only factors the documents or code support, each with its source (spec code and ID, or file path). Never invent a factor.

Start from the vision's "Restrições técnicas conhecidas": treat each as a factor with high weight, confirm each one with the user in one question before proposing a stack (it may have changed since the start), and in the vision mark it "confirmada pela arquitetura" (citing the ADR) or record that it was dropped and why.

- Multi-tenant: several client companies in one system, each isolated from the others.
- Personal and financial data: anything under LGPD (names, documents, payments, health, minors).
- Initial scale and order of magnitude: expected users, records, average/peak requests and yearly storage growth.
- Recovery tolerance (RTO/RPO): how long the business accepts the system being down and how much recent data loss is acceptable, guiding backups and restore tests.
- Team size and skills: who will maintain this, and what they already know.
- Platforms: web, mobile (iOS, Android or both), integrations.
- Full monthly budget: hosting plus the sum of third-party SaaS add-ons (auth, e-mail, logs, queues, managed database, AI), so add-ons do not blow the ceiling.
- Others the specs impose: availability, sync vs async work, offline use, files, notifications, auditing.
- Use of AI: the system sends text to an AI model (`product.uses_ai`, or a spec that asks for it); see "AI calls and prompt injection".

Ask the user only what the documents do not answer and the choice depends on: team, budget, expected scale, where the data must live. One question at a time, in business words:

> Quanto você aceita gastar por mês para manter o sistema no ar, mais ou menos? Uma faixa já ajuda (por exemplo, até R$ 500, até R$ 2 mil, mais que isso). Se ainda não sabe, eu uso a faixa mais barata que atende e deixo isso marcado como "a estimar".

If the user cannot answer, record the factor as unknown and its effect on the choice; do not assume a number.

Give the factor table a `Peso` column (`alto`, `médio` or `baixo`), each weight proposed with its source. Weights are set before options exist, so no option is argued backwards. Always confirm the weights with the user before showing any stack, in one question. The weights question replaces factor questions the documents already answer. In Validate too: weigh the factors before judging the given stack.

> Para escolher a tecnologia, vou pesar estes pontos. O que pesa mais para você: custo mensal baixo, prazo curto ou facilidade de achar quem mantenha? Proponho [peso de cada um]. Pode ajustar ou dizer "pode seguir".

"pode seguir" accepts the proposed weights; record them as accepted by the user, with the date, in `docs/arquitetura/README.md`.

## Mode Suggest

1. State the factors and which spec supports each (short table).
2. Propose a stack by layer, following the rules below: interface, server, data, hosting, login, file storage if needed, and test tools.
3. Write one ADR per choice, from [adr.md](../templates/pt-BR/adr.md). Fill every field in business language:
   - Contexto: the factor or spec pressure behind it.
   - Decisão and Alternativas: the chosen option and at least one real alternative with why it lost.
   - Por quê: time, risk, team, cost.
   - Critério que decidiu: the highest-weight factor that decided the choice, with its weight.
   - Custo de reverter: easy, medium or hard, and why, including what becomes harder after this decision. Highlight hard-to-reverse choices (database, login provider, hosting) so the human weighs them.
   - Custo mensal estimado: in reais, with what it depends on (including third-party add-ons). No number without a basis: write "a estimar" and who will estimate.
   - Quando revisitar: the concrete trigger (volume, latency, cost, team size or new requirement) that reopens this decision.
   - Status `Proposta`; leave `Aprovada por` empty.
4. Fill `docs/arquitetura/README.md` from its template: overview, stack table, expected load, internal boundaries (and a concise Mermaid diagram when integrations, async jobs or multiple entrypoints exist), cross-cutting API/operation rules, failure modes, deferred pieces with revisit triggers, test tools, environments and ADR list. Never write a version, price or tool name nobody confirmed. When code exists, anchor every diagram block to its real folder or entrypoint.
5. Proof of installation. Any claim about installing, building or running on the target machine (a dependency that needs no compiler, a version that runs, a port that opens) that was not proven by running it is written in the ADR as "a provar na tarefa do esqueleto", and the planner lists it among that task's done criteria ([planning.md](planning.md)). An unproven claim never reads as a fact.

Number ADRs in sequence. A decision already accepted is never edited away: a new ADR replaces it and the old one becomes `Substituída`. A `Substituída` ADR is history only: read it to understand why things changed, never apply it as a current decision.

## Mode Validate

The user supplies the stack (or it is read from the repository). Do not rewrite it into your own proposal.

1. Extract the factors (step 1) and check each against the given stack.
2. List the risks: factor not met, the stack's known weakness for that factor, maintenance or hiring risk, cost surprise, lock-in. For each risk give: what could go wrong in business terms, how likely, how to mitigate, and the cost.
3. Verdict per layer: `serve`, `serve com ressalvas` (name them) or `não serve` (say why and what instead).
4. Still write ADRs for the choices that stay, so they are recorded; mark risks you accepted in the ADR's Por quê.
5. Propose a change only where the risk is real; "different from what I would pick" is not a risk.

## Rules

- Prefer popular, stable technology: more documentation, fewer AI mistakes, easier to hire for. A newer or niche option needs a stated reason in its ADR and a hard look at its cost to reverse.
- **Guards against premature complexity.** Do not choose more pieces than the specs need. A small team starts with a synchronous modular monolith (a simple queue only for clear exceptions such as e-mail, webhooks or batch jobs), never microservices or event-driven ceremony without evidence. Keep marketing or institutional sites outside the product app. Run a quick order-of-magnitude check (initial request rate and yearly storage) before proposing cache, queues or separate workers; list deferred pieces in `docs/arquitetura/README.md` with the concrete trigger that reopens them.
- **ADR threshold.** Write an ADR for choices that affect boundaries, data storage, security, monthly cost, external dependencies or are costly to reverse. Local library swaps or implementation details stay in the plan or code.
- **Internal boundaries (especially single-repo fullstack).** Record in `docs/arquitetura/README.md` how domain modules separate inside the repository, the dependency direction (business rules isolated from UI, HTTP, ORM and external SDKs so rules can be tested without heavy infrastructure), where shared front/back contracts and types live, and explicit `allow`/`disallow` rules between layers/modules. Balance this with depth: avoid pass-through wrapper layers or heavy ceremony for simple CRUD.
- **Data contract, multi-tenant isolation and consistency.** Protect personal and financial data by design: say where it lives, who can read it, and name the LGPD effects in plain words. For relational databases with critical or multi-tenant data, the data ADR defines: the tenant isolation mechanism (for example Row-Level Security or mandatory scoped queries with tenant-keyed indexes), which store is the source of truth vs derived data (cache, search index, projection) and how derived data is rebuilt, where transactions open and close (never held open across remote calls), and how concurrent writes are protected (isolation level, optimistic version or explicit lock).
- **Integrations, failure modes, API and health.** Record a short failure-modes table in `docs/arquitetura/README.md`. Every external integration defines an explicit timeout, a retry policy only for idempotent operations (with cap and backoff) and a degraded mode. Define cross-cutting API and runtime rules proportional to the project (single error shape, mandatory pagination on listings, idempotency on critical actions such as payments or sends, resource ownership checks against IDOR, rate limits on sensitive routes, real dependency health check, and structured logs without credentials or personal data).
- Production actions (deploy, destructive migration) are irreversible actions: the stop in `gates.md` applies, whatever the architecture says.

### Test tools per platform

Every test tool must write JUnit XML into `.baco/junit/`; the engine only proves criteria from those files.

| Platform | Tool | Note |
|---|---|---|
| Rules and functions | the stack's usual runner (Vitest, Jest, Node test runner) | one per language in use |
| Web | Playwright | default for any browser flow |
| Mobile | the tool that matches the app technology: Maestro, Detox or Appium | record the choice in an ADR |

Mobile choice guide (verify against the tool's current version before writing it down):
- Maestro: simple flows written as YAML in `.maestro/`, works for native and cross-platform apps, lowest learning cost. Default recommendation when nothing pushes elsewhere.
- Detox: React Native apps, when tests must live next to the app code in JavaScript.
- Appium: native apps or several platforms that need deep device control; heavier to run and maintain.

The ADR for the mobile tool states the app technology it matched, the alternatives, and the maintenance cost. A web-only project needs no mobile entry.

### Test commands go into the config now

Choosing the tools also sets the `tests` commands in `.baco/config.yaml`, for example `tests.unit`, `tests.e2e_web`, `tests.e2e_mobile`, and for browser layers the quick version in `tests_quick.<layer>` (Chromium only, see [configure-questions.md](configure-questions.md), question 7). Follow [test-commands.md](test-commands.md), section "Known gap: each command must write its own JUnit file": each command writes its XML into `.baco/junit/`, and you run it once, with the user's consent, to confirm a file appeared. Without config, start from [config.yaml](../templates/pt-BR/config.yaml). When the project has no code yet (no dependency manifest such as `package.json`), neither the install nor these commands can run now: write them, name the install command in `docs/arquitetura/README.md`, say they are not checked yet, and leave the proof to the plan's skeleton task ([planning.md](planning.md), section 4, "Skeleton task"), which runs a clean install and the test commands in a fresh copy. Never present them as checked before that.

**Testing ADR.** One ADR records the test strategy. It states: the browsers of the full battery (from phase 1; Chromium alone unless the owner chose more); that business rules are tested inside, with the unit runner, where a test is fast and exact; and that the browser covers the main paths only (the few flows a user walks through), never one browser test per rule. The reason, in business words: browser tests are slow and break easily, so they prove that the pieces connect, not every rule.

### Preview for the owner

In the Ratoeira (detected by `/usr/local/bin/ratoeira-cron` or `~/.config/ratoeira/`), at a human stop or when manual scenarios are about to be tried, offer the human, as a question and never automatically, a preview of the app on a link with login only for them (Ratoeira "Publicados", through the Ratoeira's own `publicar-ratoeira` skill), so they can try the screens instead of only looking at screenshots. Record the choice (yes, no, and who sees it) in the testing/homologation ADR, and offer to take the preview down at the end of the delivery. Outside the Ratoeira, offer the local way to run the app described in the ADR.

### Browsers checked in the homologation environment

A browser that runs on the developer's machine may not open in the environment where the human will check the app (homologação). Before asking for approval, run a minimal test in each chosen browser (open the app or a blank page, one click) in that environment, and record the result per browser in `docs/arquitetura/README.md` (works, does not open, why). A browser that does not work there is a finding: fix the setup or take it to the human with the cost of dropping it. Never write "works in Safari" or "works in Firefox" without that run.

### Start the app and prepare the test data

- `app.smoke` in `.baco/config.yaml`: a command that starts the app as the user does, checks it answers, and exits 0. It never asks anything interactively. If the project has no app yet, ENT-001 creates it and the command is written then. Check it with `baco run-tests --smoke`.
- If tests need a database, the project gets scripts (written in ENT-001, or in the first task that touches the database) to prepare and to clean the test database. Each script has its own lock: it refuses to run unless it is sure it points at the test database, so it can never touch real data. Those scripts are what `tests` and the implementers call; nobody types a loose delete command.
- No command of the project asks a question while running. A prompt becomes a flag, a variable or a script that answers it.

Commit the config change together with the architecture documents, before the first delivery plan records its `**Base:**`. A later change to the `tests` or `tests_quick` section or to `app.smoke` makes `guard-tests` stop with a human gate (see `gates.md`, `CONFIG_TESTS_CHANGED`), so settle the commands here.

## AI calls and prompt injection

When `product.uses_ai` is on, or a spec has the system send text to an AI model (to summarize, classify, answer, pick a next step or call tools), that call is an important choice: it gets an ADR, or a section "Injeção de instruções" in the ADR of the call ([adr.md](../templates/pt-BR/adr.md)). Prompt injection is text that reaches the model from outside (a form field, an imported spreadsheet, an email, a web page, an item from an integration, content other users saved, a file) carrying instructions the model then follows. No measure eliminates it: assume some attacks succeed and limit what they can do. Filters and classifiers that look for attacks are an extra layer, never the boundary. The ADR covers, in business words:

1. **Sources and trust.** Each text that reaches the model, where it comes from (the system itself, the logged-in person, another user, a third party) and how much it is trusted.
2. **What the answer may do.** Only suggest to a person, or write and act (save, send, call another system). The less it does alone, the smaller the damage.
3. **Instruction apart from data.** Untrusted text never goes into the system or developer instructions: only in the user turn or in tool-result blocks, labeled with its source, with third-party strings JSON-encoded so they cannot break out of the label.
4. **Fixed output.** A format (schema, closed lists of values) the code checks before use; an answer outside it is refused. The answer is untrusted too: validated or escaped before it reaches the database, HTML, SQL, a shell or another call.
5. **Least privilege.** No secret, tool or data the call does not need; the call that reads untrusted text gets no write tools where possible; permission checks live in code, outside the model, with the rights of the person the call serves.
6. **Confirmation.** An impactful action (send, pay, delete, change a permission, share data) shows the person the exact action, target and arguments, and waits for a yes.
7. **Record.** What was sent and received and what was done, without credentials or personal data the record does not need.
8. **Adversarial tests.** The spec's attack scenarios ([spec-model.md](spec-model.md), "Acceptance and semantic coverage") run as automated tests where they can.

The devil's advocate attacks this ADR; the plan puts `prompt injection` in `Foco de revisão` ([planning.md](planning.md), section 7); the final review checks each measure against the code ([review-protocol.md](review-protocol.md), "Review focus and reviews of a fix"). A spec that brings the first AI call while `product.uses_ai` is off turns it on, and you tell the person ([project-bootstrap.md](project-bootstrap.md), "Use of AI").

Sources:
- OWASP, "LLM01:2025 Prompt Injection", OWASP Top 10 for LLM Applications 2025: https://genai.owasp.org/llmrisk/llm01-prompt-injection/
- OWASP Cheat Sheet Series, "LLM Prompt Injection Prevention Cheat Sheet": https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html
- Anthropic, "Mitigate jailbreaks and prompt injections" (Claude API docs): https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/mitigate-jailbreaks
- Anthropic, Claude Code "Security": https://code.claude.com/docs/en/security
- OpenAI, "Safety in building agents": https://developers.openai.com/api/docs/guides/agent-builder-safety
- OpenAI, "Designing AI agents to resist prompt injection" (2026-03-11): https://openai.com/index/designing-agents-to-resist-prompt-injection/

## Devil's advocate

Before the human sees anything, run the role [devils-advocate](roles/devils-advocate.md) on the proposal (Suggest) or on your verdict (Validate). Give it the factor table, the stack, the ADR drafts, the approved specs and the per-browser result of the homologation check; no conversation history.

- It attacks: a chosen browser never opened in the homologation environment ("browser not checked in the environment"), wrong factor weights, a requirement the stack cannot meet, cost that grows faster than the budget (including third-party add-ons), lock-in, a choice that is hard to reverse, a test tool with no JUnit output, a missing factor (such as RTO/RPO, LGPD, multi-tenant isolation or scale), an alternative listed only to lose (straw-man), premature complexity via a **subtraction test** (removing a disputed piece or layer to see if a spec guarantee is lost or only maintenance work), an external call without timeout, inside a DB transaction, or retried without idempotency, derived data without a rebuild rule, API/login missing error/pagination/IDOR/rate-limit basics, an AI call whose ADR misses a measure of "AI calls and prompt injection" or treats a filter as the boundary and, in a Revisit or a technical change, no comparison with keeping things as they are (keep as is) or no compatible transition and rollback plan on a live system.
- For each objection, either change the proposal and ADR, or keep it and write the reason in the ADR's Por quê. Never drop an objection silently.
- Show the human the objections that remain open, in plain words, with your answer to each. Report this as `proposto`, never as verified.

## Present and gate

Present using the communication labels of `SKILL.md`: Entendimento (the factors), Decisões (stack by layer, one line each, with monthly cost range and reversal difficulty), Achados (open risks and devil's advocate objections), Recomendação, Próximo passo. Keep it short; the ADRs hold the detail. Then ask for approval using the sentence in `gates.md`, naming `docs/arquitetura/README.md` and the ADR list.

The recommendation is never approval. Stop until the human states it explicitly. If they want changes, update the documents and present again.

After an explicit "sim":
- Set each approved ADR to `Aceita`, with the date and the approver's name in its table.
- Record the approval in `docs/arquitetura/README.md` (approver and date next to the ADR list).
- If `gates.architecture` is `off` in the config, still write the ADRs as `Proposta` and say plainly that no one has approved them; the first plan stop is where the human sees them.

Closing message when approved (`verificado` only for what you checked):

> Arquitetura aprovada e registrada em `docs/arquitetura/README.md`, com [N] decisões em `docs/arquitetura/adr/`. Custo mensal estimado: [faixa]. Próximo passo: planejar a primeira entrega, que também serve para provar na prática que essa escolha funciona.

## Architecture proof: ENT-001

An architecture on paper is not proven. The first delivery, ENT-001, implements the smallest real spec that exercises the architecture end to end, typically authentication or the simplest register-and-list capability: interface, server, data, login, deploy and CI all take part.

Criteria for the choice (the planning phase, `planning.md`, applies them when it proposes the cut; the human approves it at the plan gate):
- It crosses every layer in the stack, including data storage and login if the product has them.
- It is real product scope from an approved spec, not a throwaway demo.
- It is small enough to finish in one delivery.
- It has acceptance criteria that can run as automated tests in each test tool chosen (web, and mobile when present).

ENT-001 must also deliver, as part of its scope:
- CI from [ci-github-actions.yml](../templates/pt-BR/ci-github-actions.yml), copied to `.github/workflows/baco-testes.yml`, adapting the lines marked `ADAPTE`, running the tests and uploading `.baco/junit/`.
- Deploy to a non-production environment (homologação) running from the pipeline. A production deploy is an irreversible action and stops for the human.
- Tests of every tool in the ADRs, running locally and in CI, with the criterion ID in each title (`[CA-…]`).
- A clean install proven in a fresh copy by its skeleton task ([planning.md](planning.md), section 4), so a missing build tool or system library shows up in the first task.

The architecture counts as proven only when ENT-001 is accepted: tests green in CI, the deploy reachable, and the acceptance report approved. Record that in ENT-001's `progresso.md`. If the proof exposes a flaw, do not patch around it: open a Revisit, write the new ADR (the old one becomes `Substituída`) and take it through the gate again.

## Revisit

Trigger: a new or changed spec brings a factor the architecture did not weigh (new platform, much higher scale, a new kind of sensitive data, an integration that does not fit), or ENT-001 or a later delivery found a flaw.

1. Re-run step 1 for the new spec only and compare with `docs/arquitetura/README.md` and the accepted ADRs.
2. No pressure found: say so and change nothing.
3. Pressure found: say which spec, which ADR and what breaks, with the cost of keeping versus changing. Write a new ADR for each changed choice; never edit an accepted ADR; mark the replaced one `Substituída`. When the system is already live with real users or data, include `Plano de transição e lições aprendidas` in the new ADR ([architecture-audit.md](architecture-audit.md), section 4); when triggered by slowness or structural debt, apply the measured protocol (section 3). Update the stack table and ADR list.
4. Run the devil's advocate and the gate again, only for the changed decisions. An unchanged accepted ADR keeps its approval.
5. Tell the planning phase which approved plans depend on a replaced ADR; those plans need a human look before running.

## Technical change without behavior change

Trigger: a technical decision that changes no behavior: change hosting, database or framework, optimize measured slowness, pay structural debt, or update a version to close a security flaw. Without this path the change either gets a fake spec to justify it or happens with no record of why.

1. Write a new ADR and take it through the devil's advocate and the `architecture` gate. Its alternatives always include keep as is, with the cost of keeping versus changing (including team learning curve). With a live system, include `Plano de transição e lições aprendidas` ([architecture-audit.md](architecture-audit.md), section 4); when triggered by slowness or debt, follow the measured protocol (section 3).
2. With nothing implemented yet (no catalog row has a `Versão implementada`), there are no criterion tests to protect: update the ADR and `docs/arquitetura/README.md` only, and there is no delivery.
3. Otherwise open a delivery ([planning.md](planning.md)) whose plan lists in `**Specs:**` every implemented spec the change can touch, at its current version. There are no spec changes. The tasks are technical; the done criterion is that every existing criterion test still passes: `baco trace` per spec and `baco acceptance-report` as usual, with every CA in `Cobertura` pointing to its existing test. Manual scenarios count too: re-run them with the user and record each with `baco qa-evidence <qa.md> --ct <CT-ID> --result aprovado --where <text> --delivery ENT-NNN`, because only evidence of this delivery counts.
4. The trace checks every CA of the spec file. A spec that is not fully built (state other than `implementada`, or `Versão` ahead of `Versão implementada`) has CAs with no test, and those block the acceptance. Then either wait until that spec's delivery is done, or ask the human how to cut the change; never mark those CAs as covered.
5. The level is at least `normal`, and `completo` when the change is costly to undo (database, login provider, hosting).
6. If the change would alter behavior, stop: it is a spec evolution first ([spec-change.md](spec-change.md)).
7. When phase 0 changes `test_runs` in the config and an accepted ADR states what runs when (for example that the full battery runs on every merge), offer the person a new ADR that supersedes that item, with the new rule and the reason. It goes through the `architecture` gate like any ADR: the person approves it, and you never write or accept it alone.

## Mode Audit (code architecture audit)

Trigger: the user asks to audit the architecture of an existing codebase ("auditar arquitetura"), typically between deliveries or before a major evolution. No gate and no code or ADR edits. Dispatch [architect](roles/architect.md) in mode `Audit` following [architecture-audit.md](architecture-audit.md), section 2, writing only `.baco/logs/revisoes/arquitetura-auditoria-NN.md`. Check `git status` afterwards, present the material findings and the `shortcut:` ledger in plain pt-BR, and turn chosen items into a `Revisit` or a normal delivery only with the user's go-ahead.

## Hand-off

- `docs/arquitetura/README.md` and `docs/arquitetura/adr/` are the references planning reads (`planning.md`) and the review of the delivery's PR points the reviewer to: the review step passes each relevant ADR to the engine with `--adr docs/arquitetura/adr/ADR-NNN-<slug>.md`, and the request lists its path (see `build-handoff --mode pr` in `scripts/README.md`).
- The test tools and commands are what implementation (`implementation.md`) and the trace step rely on.
- Run the documentary reconciliation gate of `common-process.md` (section 5) before declaring the phase done: architecture, ADRs, config, vision, roadmap and specs must not contradict each other. Report what you checked, what changed and what remains pending.
