# Phase 2: Specify — adaptive functional spec model

Output: `<docs>/specs/spec-<nome>.md` (versioned in place), `<docs>/qa/cenarios-qa-spec-<nome>.md`, and the catalog row updated. Gate: `spec_approval` (mandatory, see [gates.md](gates.md)). Load this reference with [common-process.md](common-process.md) to create, audit or evolve a spec. For an approved or implemented spec that changes, also load [spec-change.md](spec-change.md). For inconsistency analysis and readiness, apply [review-protocol.md](review-protocol.md).

`<docs>` is `docs_root` from `.baco/config.yaml` (default `docs`). If the project has its own spec/QA paths and names, they win.

## Minimal contract

Produce a document that lets a reader identify **outcome, audience, conditions, limits and verification**, without delegating to the implementer product decisions that are still open. Use the smallest structure able to express the contract; respect the project's documentary governance. At the close, run the documentary reconciliation gate ([common-process.md](common-process.md), step 5) over the related notes and records.

## A spec carries business rules only

The spec says what the product must do and for whom, in terms a business person can confirm. It never carries implementation detail: how the screen behaves internally (keyboard focus, which element is selected), how ties are broken in code (by millisecond, by internal id), component, table, endpoint or library names, algorithms. Such detail belongs in an ADR, the plan, the task or the code. Test: could the owner confirm or reject this sentence without knowing how the system is built? If not, cut it or move it. A detail that changes what the user sees or what money, data or access result stays, written as its observable effect ("the oldest request is served first"), not as its mechanism. The cold reader and the spec auditor flag implementation detail as a finding.

Respect the vision's "Restrições técnicas conhecidas": a spec never asks for behavior those constraints make impossible or costly without saying so. When a needed behavior conflicts with one, record the conflict in the spec's open questions and tell the user; phase 3 decides.

## Six looks before writing (optional)

Before writing a spec, the idea can go through six short read-only passes, run in parallel when the host has subagents (otherwise one after the other, inline). Each pass reads the idea and the sources, and returns at most five lines. Reuse the same generic prompt with one question each:

1. **Not needed now:** what in the idea could wait or be dropped without losing the main outcome (YAGNI).
2. **Cost:** what this makes more expensive to build, run or keep, in business terms.
3. **Usability:** where a person using it could get lost, make a mistake or give up.
4. **Migration and compatibility:** what happens to existing data, screens and users.
5. **Observability:** how we will know it broke, and who finds out.
6. **Future maintenance:** what becomes hard to change later, and who maintains it.

Offer them when the idea shows a risk signal: money, personal data, something hard to undo, or more than one area of the product touched. Also run them when the user asks. Never force them: if the user declines, go on. The delivery level is only decided in the plan, after the spec, so the signals above are the criterion here. Offer in these words:

> Essa ideia mexe com [sinal: dinheiro, dados pessoais, algo difícil de desfazer ou mais de uma área]. Antes de escrever a spec, posso fazer seis olhadas rápidas: o que não precisa agora, quanto custa, se é fácil de usar, o que acontece com o que já existe, como saberemos se quebrou e quem mantém depois. Leva poucos minutos. Quer que eu faça?

Fold the results into the discovery: what changes the contract becomes a question or a decision; the rest is noted as consciously deferred. A look is advice, never a requirement.

## Sections as needed

1. **Document control and sources:** title/ID of the capability, state, version or cut, sources actually consulted, approval and history. Never confuse a decision confirmed in conversation with persistence in the repository.
2. **Goal, problem, scope and boundaries:** goal, audience, covered behavior, explicit exclusions, interfaces with adjacent capabilities. Never invent the version's scope.
3. **Actors and concepts:** roles, permissions and definitions only when they change the outcome or avoid ambiguity.
4. **Normative contract:** functional requirements (RF), business rules (RN), invariants (INV) and verifiable non-functional constraints (RNF) when relevant. Separate capability, decision condition, and a property that must never be violated.
5. **States and flows:** flows, states, transitions, errors, concurrency, repetition, reversal and material time limits. Do not demand a section for an irrelevant topic.
6. **Data, policies and experience:** data essential to the contract, cross-cutting policies, relevant experience, and functional dependencies on adjacent capabilities, including the condition and expected result on failure when material. Reference canonical sources instead of copying them; do not prescribe architecture.
7. **Acceptance criteria:** CA criteria in **Dado / Quando / Então** form, each with precondition, event and observable effect; cover positive and negative paths and boundaries that change the outcome.
8. **Decisions and pending items:** approved decisions, hypotheses, proposed technical conventions, and pending items with impact and destination. Record clarification questions and answers here or in the history (see [common-process.md](common-process.md), step 2).
9. **Semantic traceability, readiness and history:** semantic RF/RN/INV → CA/QA links, coverage and one verdict per cut, plus relevant changes.

Omit or merge sections without meaningful content. When defining boundaries, identify purpose, normative owner and dependencies between capabilities only when relevant to the outcome. To assess cohesion, legitimacy of dependencies and effects of failures or changes, use [review-protocol.md](review-protocol.md). User stories may complement the contract, never replace RF/RN/acceptance. Documentary QA derives from the contract and creates no autonomous functional policy.

## Templates

Start from [spec.md](../templates/pt-BR/spec.md) (full, the nine sections plus approval and history) or [spec-minima.md](../templates/pt-BR/spec-minima.md) (small capabilities). They are **copyable examples, not mandatory templates**: the project's convention and canonical source prevail. When using them, **omit or combine irrelevant sections**, delete fields without information, and never create empty sections to complete a structure. **Never invent version, date, approver, sources, decisions, coverage or test executed.** The example IDs (`XYZ`) are not approved requirements; use them only if they do not clash with the local convention, and do not multiply RF, RN, INV, CA or pending items to fill the skeleton. Never write over an existing spec with a template.

Keep these engine-readable shapes (see the engine README in `scripts/`): definitions as headings (`### RF-XYZ-001 | título`), bold bullets or rows of a table whose first header is `ID` (the ID cell holds only the ID; a criterion's title goes in its own `Título` column); metadata `Código` and `Versão`; a history table with `Versão` and `Alteração` (or `Descrição`/`Mudança`) whose last row equals the metadata version; an acceptance section whose heading contains "aceite". Existing specs already in another recognized shape stay as they are.

## Entry block

Every new spec starts with `## Porta de entrada`: five bullets (O quê, Para quem, Por quê, Fica de fora, Como saber se deu certo), as in the templates. It lets a person, or an agent reading a neighbouring spec, understand the capability without reading the contract.

- The entry block **never creates a requirement**. The normative contract below always prevails; if they disagree, fix the block.
- No IDs inside it, so the block never looks like a requirement.
- Fill it only from interview answers and sources. With no business metric yet, write `a definir`; never invent a number.
- Review it at each evolution of the spec. For specs that do not have it yet, see [spec-change.md](spec-change.md), section 5.

**Longevity test.** "If we changed technology tomorrow, would this sentence still be true?" If not, it belongs in an ADR or in the code, not in the spec.

## Identifiers and sources of authority

- Preserve the project's existing ID convention, namespaced (`RF-EMP-001`) or plain (`RF-001`). Never renumber.
- With no convention, propose stable IDs: `RF-001`, `RN-001`, `RNF-001`, `INV-001`, `CA-001`, `QA-001`, `P-001` (or namespaced with a unique 2–6 letter capability code, `RF-XYZ-001`, when the project will have several specs), without reserving series without need. QA scenarios use `CT-…` in the same scheme.
- Never reuse, renumber or recycle published identifiers. The spec holds only the current contract: a retired item leaves it, the version row names it by ID, and the metadata line `Próximos números livres` (the highest number ever used in each series, plus one) keeps its number from coming back. A replacement the reader needs today (a rule that takes over from another) is stated in the current text, not as history. Projects that keep a table of retired IDs with a `Situação` column may go on doing so; the engine reads those rows as retired, not as definitions.
- Distinguish **approved product rule** (authority and source), **interpretation to validate** (outcome depends on confirmation) and **proposed technical convention** (delegable representation or implementation). Never raise a hypothesis or recommendation to approval.
- In ambiguities of date, period, time zone, rounding, uniqueness, concurrency or authorization, make the functional difference explicit before choosing an interpretation.

## Acceptance and semantic coverage

For each RF/RN/INV → CA/QA link, confirm the verification covers the **same actor**, the **same operation**, the **boundary condition**, the **polarity** (allow or deny) and the **expected effect**. Textual presence of the ID is not coverage. Classify the link as covered, partially covered, missing or not applicable, with a reason; **not applicable** needs an explicit reason and never counts as proven coverage.

Example: if the rule allows a request up to the seventh day inclusive, an acceptance criterion denying the eighth day does not prove the authorization on the seventh. Add or adjust a scenario for the allowed limit; do not create dozens of equivalent CAs to look broad. Define data sets, dates and specific results when precision is needed to verify the behavior.

**Capability that sends text to an AI.** When a capability has the system send text to an AI model (and `product.uses_ai` is on, or this spec turns it on, [project-bootstrap.md](project-bootstrap.md), "Use of AI"), its criteria and QA scenarios include attacks: malicious instructions in a form field, in an imported spreadsheet, in an item coming from an external integration (as the capability receives them). Each states the expected behavior in business words: the system does not perform the injected action; an answer outside the expected format is refused; an action that needs confirmation waits for the person; the attempt is recorded. The protections themselves belong to the ADR ([architecture.md](architecture.md), "AI calls and prompt injection"), not to the spec.

## Pending items and spec state

Record a pending item only when it affects a verifiable outcome and cannot legitimately be decided now: **ID, question, reason, affected operation, consequence, owner when known, and destination/resume condition**. State what remains contractually defined and what is blocked. Do not create a parallel product backlog; use the available canonical record (for future ideas, `governanca/anotacoes-futuras.md` when it exists) and reconcile it at the final gate.

Separate **candidate (full or partial)**, **approved by human authority**, **implemented** and **tested**. One mark never implies another. In the catalog they are independent columns: `Situação documental` (`Rascunho`, `Em descoberta`, `Em revisão`, `Aprovada`, `Substituída`), `Implementação` and `Validação`. Phase 2 moves only `Situação documental` and `Versão`, edited by hand in the row; it never sets implementation or validation (`não verificada` for a new row, or the existing value). Record `Aprovação` (who, date) only after the explicit human approval.

For each cut, give one coherent verdict: `apta`, `apta com dependências` (delimited technical/external dependencies) or `bloqueada`. Never classify as `apta com dependências` an operation that depends on an essential rule still undecided. See [review-protocol.md](review-protocol.md) for criteria and severity.

## Creation, discovery and evolution

During discovery, record decisions and short deltas; checkpoint, and accept a voluntary close with a partial candidate. Produce a full version at an appropriate milestone or when asked, not after every answer.

In evolution (details and engine support in [spec-change.md](spec-change.md)):

1. Identify the current contract, baseline and authority of the sources; compare **before/after per behavior**, not per word swap.
2. Record operations and rules modified, preserved, new or discontinued, and their validity. Prospective changes do not automatically invalidate earlier data and actions: examine their effects on queries, conflicts, eligibility and availability.
3. Preserve IDs; add new identifiers only when the new meaning requires it. Do not turn a partially superseded decision into a fully revoked one.
4. Analyze effects on adjacent specs, policies, permissions, QA and journeys before presenting the editable delta. Use [review-protocol.md](review-protocol.md) for review and reconciliation.
5. Produce a consolidated version at a significant documentary milestone or when needed for use. Do not bump the version on each isolated answer.

Do not embed arbitrary technical decisions in the contract and do not duplicate cross-cutting policies. Reference the canonical source by relative path; keep the capability-specific exception, and record conflicts without resolving them for convenience.

## QA scenarios file

Create `<docs>/qa/cenarios-qa-spec-<nome>.md` from [cenarios-qa.md](../templates/pt-BR/cenarios-qa.md) when it does not exist; when it exists, update it in place and keep its structure. The QA file has no version of its own: record the exact spec version it derives from (`| Versão da spec | X.Y |`). Each scenario:

- heading `### CT-… | título`, in the project's ID scheme;
- `- **Contratos:**` the CA/RF IDs it proves (semantically, see above);
- `- **Automação:**` `automatizado` (with the test path in backticks), `manual` (a script a person can run) or `pendente` (not decided yet; the planning phase settles it). Add this line to existing scenarios that lack it, next to any existing strategy field.

Every spec change requires reviewing the QA; when no scenario changes materially, say so explicitly in the QA's `Situação do QA` line. Evidence rows are appended later by `baco qa-evidence`, never invented.

## Before the approval gate

1. Run `baco validate-spec <spec>`. Fix every error-level finding (`DUPLICATE_ID`, `CA_MISSING_GWT`, `MISSING_ACCEPTANCE_SECTION`, `VERSION_MISMATCH`, `RETIRED_ID_REDEFINED`, `NO_DEFINITIONS`) and re-run until exit 0. Review warnings (`MIXED_CAPABILITY_CODE`, `DANGLING_REF`, `NO_HISTORY`, `UNRECOGNIZED_DEFINITION`); fix them or state why they stay. `UNRECOGNIZED_DEFINITION` points to an item written in a shape the engine does not read: rewrite it in a recognized shape. Check `counts` against the definitions you wrote.
2. Run the role [cold-reader](roles/cold-reader.md) and the pre-approval reconciliation ([common-process.md](common-process.md), step 4); for audits or high-risk specs, also the role [spec-auditor](roles/spec-auditor.md) with [review-protocol.md](review-protocol.md). Handle each finding by the rules in [review-protocol.md](review-protocol.md), "Handling review findings".
3. After those reviews, run the role [simplifier](roles/simplifier.md) over **only what the reviews added** (text, criteria, rules that were not in the candidate before them), giving it the spec and that list. It proposes cuts: defenses, complexity and behavior nobody asked for. Each proposed cut is handled like any finding. Skip it when the reviews added nothing.
4. Update the catalog row, or add it for a new spec (`Em revisão`), run the documentary reconciliation gate, then ask for `spec_approval` and wait. Only after an explicit "sim" set `Aprovada` and record the approval (who, date, version) in the spec and in the catalog `Aprovação` column. In the same commit, update every document that still describes the capability as without a spec: the roadmap line in `planejamento-do-produto.md` (for example "ainda sem spec" becomes the spec, its version and `Aprovada`) and the indexes that list it.
