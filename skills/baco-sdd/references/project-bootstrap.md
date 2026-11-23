# Phase 1: Start a project (lean documentary governance)

Output: the smallest useful `docs/` set (vision, roadmap, governance, empty catalog, index). Gate: `project_start` (see [gates.md](gates.md)). Load this reference with [common-process.md](common-process.md) when the user starts a project, or brings an existing one whose documentation must be organized.

Goal: prepare a source of truth that people and agents can read, without creating a repository of empty documents and without depending on this skill being installed to understand approved contracts.

`<docs>` below is `docs_root` from `.baco/config.yaml` (default `docs`).

## 1. Minimal discovery

Identify purpose, audience, product stage, who decides, state of the sources, applicable repository/branch, and the immediate need for documentation. Never invent the V1 scope. If the user interrupts the interview, consolidate a **partial** vision with its gaps; do not stretch the interview artificially.

### Browsers

If the product has a web interface, ask once which browsers it must work in. Suggest Chromium alone unless the audience needs more; a product used by people on iPhone or Mac usually needs Safari (WebKit) too.

> O sistema vai ser usado pelo navegador. Em quais navegadores ele precisa funcionar? Eu sugiro começar só pelo Chrome (Chromium), que cobre a maioria. Se seu público usa iPhone ou Mac, vale incluir o Safari. O que prefere?

Record the answer in the vision (or in the discovery notes) as a product constraint. Phase 3 uses it for the testing ADR and `tests` in `.baco/config.yaml` ([architecture.md](architecture.md)); phase 0 uses it for the full test command ([configure.md](configure.md)). No web interface: skip the question.

### Known technical constraints (optional)

Ask once, near the end of the interview, whether a technical decision is already taken or a constraint must be respected. Examples: where it must run (a given host or cloud), a system it must talk to, what the team already knows, data that must stay in a country, offline use, a mobile app. Never ask the user to choose a technology here; the choice belongs to phase 3, after the first approved spec.

> Já existe alguma decisão técnica tomada ou alguma restrição que eu deva respeitar? Por exemplo: onde o sistema precisa rodar, um sistema que ele precisa conversar, o que o time já sabe usar, ou dados que precisam ficar no Brasil. Se não houver, tudo bem: a tecnologia é escolhida depois da primeira spec.

Record each answer in the vision under "Restrições técnicas conhecidas", with its source (who said it, when) and the mark "ainda não confirmada pela arquitetura". No answer: write "nenhuma informada". Specs respect these constraints ([spec-model.md](spec-model.md)); phase 3 starts from them and confirms each one with the user ([architecture.md](architecture.md), step 1).

### Use of AI

Ask once whether the system will call an AI model (skip it when `product.uses_ai` is already set in `.baco/config.yaml`):

> O sistema vai usar inteligência artificial em alguma parte? Por exemplo: resumir um texto, classificar um pedido, responder um cliente ou sugerir o próximo passo. Pergunto porque texto vindo de fora (um formulário, uma planilha, um e-mail) pode trazer instruções escondidas que a IA obedece, e aí a arquitetura e os testes precisam tratar disso.

With a yes, write `product.uses_ai: true` in `.baco/config.yaml` (on the `baco/configuracao` branch, as in [configure.md](configure.md), "Write the file"), and note in the vision that the system uses AI. Later, whenever a spec or an ADR brings a call to an AI model while the key is `false` or missing, set it to `true` in the same branch of that work and tell the person in one sentence: "A spec [nome] faz o sistema chamar uma IA, então liguei o cuidado com injeção de instruções: a arquitetura, os testes e as revisões passam a tratar disso." With the key on, the requirements of [architecture.md](architecture.md) ("AI calls and prompt injection"), [spec-model.md](spec-model.md), [planning.md](planning.md) and [review-protocol.md](review-protocol.md) apply.

## 2. Choose the smallest useful structure

The default structure follows this model. It is a ceiling, not a checklist: **create only what has real content**.

```text
<docs>/
├── README.md                     # map of the documentation, conventions, branches
├── visao-do-produto.md           # only with enough discovery
├── planejamento-do-produto.md    # roadmap: source of prioritization and cut
├── catalogo-de-specs.md          # index of specs + independent states
├── governanca/
│   ├── README.md                 # minimal norms, when needed
│   └── anotacoes-futuras.md      # future ideas, outside the current scope
├── specs/spec-<nome>.md          # created in phase 2
├── qa/cenarios-qa-spec-<nome>.md # created in phase 2
└── fontes/                       # optional: meeting and interview transcripts, only when they exist
```

If the project already keeps transcripts elsewhere (for example `pesquisa/`), that place wins. How to use them: [common-process.md](common-process.md), step 2.

Add `specs/`, `qa/`, the catalog, local templates or policies only when there are real documents, several contracts, local variations or an operational need. Do not create a README per folder to duplicate the index. One initial governance document may hold the essential rules; split it only when that eases maintenance. Later phases add `arquitetura/` (phase 3, `architecture.md`) and `entregas/` (phase 4, `planning.md`); do not create them here.

### Template → target path

Templates live in `../templates/pt-BR/`. Their names differ from the target names; use this mapping.

| Template | Target |
|---|---|
| [docs-README.md](../templates/pt-BR/docs-README.md) | `<docs>/README.md` |
| [visao-do-produto.md](../templates/pt-BR/visao-do-produto.md) | `<docs>/visao-do-produto.md` |
| [planejamento-do-produto.md](../templates/pt-BR/planejamento-do-produto.md) | `<docs>/planejamento-do-produto.md` |
| [catalogo-de-specs.md](../templates/pt-BR/catalogo-de-specs.md) | `<docs>/catalogo-de-specs.md` |
| [governanca-README.md](../templates/pt-BR/governanca-README.md) | `<docs>/governanca/README.md` |
| [anotacoes-futuras.md](../templates/pt-BR/anotacoes-futuras.md) | `<docs>/governanca/anotacoes-futuras.md` |
| [spec.md](../templates/pt-BR/spec.md) or [spec-minima.md](../templates/pt-BR/spec-minima.md) | `<docs>/specs/spec-<nome>.md` (phase 2) |
| [cenarios-qa.md](../templates/pt-BR/cenarios-qa.md) | `<docs>/qa/cenarios-qa-spec-<nome>.md` (phase 2) |
| [arquitetura.md](../templates/pt-BR/arquitetura.md) | `<docs>/arquitetura/README.md` (phase 3) |
| [adr.md](../templates/pt-BR/adr.md) | `<docs>/arquitetura/adr/ADR-NNN-<slug>.md` (phase 3) |

Rules for templates:
- **Never overwrite an existing file with a template.** If the target exists, it wins; the template is at most a checklist of what may be missing, proposed as a delta.
- Fill templates with real content and delete placeholder lines, example rows and sections without content. The catalog starts with no spec rows (remove the example row) unless a spec already exists.
- Keep the template guidance comments only while they help the author; never present them as decisions.
- `<nome>` is lowercase, hyphen-separated, no spaces or accents, and identical for a spec and its QA file.

## 3. Governance core

Document enough for someone who does not have this skill: where the contracts are; source and precedence; the distinct states candidate / approved / implemented / tested (in the catalog: situação documental, implementação, validação, independent of each other); decision authority; the ID convention; updating and traceability; how to record changes (documents describe the current state; history lives in Git; `Próximos números livres` prevents reuse); how to consult QA, policies and references. Do not duplicate generic method instructions and do not build a parallel backlog.

Use **relative Markdown links** and portable paths. Check that they point to existing files or are future references explicitly marked as such. Separate rules already approved, drafts and recommendations.

## 4. Existing projects and migration

Inspect the applicable documentation before proposing any structure. An existing project (for example one with namespaced IDs like `RF-EMP-001`, its own governance, catalog and QA files) keeps its conventions, file names, ID scheme, headings and states; this skill adapts to it, not the reverse.

- Present the options `manter / consolidar / substituir / remover mais tarde`, each with risks, effects on references and a reversal strategy. Default to `manter`.
- Preserve normative decisions and contracts; keep an identifiable Git baseline; recommend a pilot before any mass migration.
- Never change, rename, move or delete a document without explicit authorization. Never reformat approved specs to match a template.
- Only add what the engine needs and is missing, as a proposed delta, for example the `Versão implementada` / `Versão validada` catalog columns (the engine adds them itself on first write by `baco catalog set`) or a `- **Automação:**` line per QA scenario (alongside any existing strategy field, never replacing it).
- A user entering at phase 2 or later with such a structure skips this phase; do not force it.

Options message (adapt, one line per option):

> Encontrei documentação existente em [caminho]. Posso: **manter** como está (recomendo), **consolidar** [o quê], **substituir** [o quê] ou **remover mais tarde** [o quê]. Nada é alterado, renomeado ou apagado sem você autorizar. Qual prefere?

## 5. Delivery gate

Confirm that every proposed file has a purpose, that the index and links do not mislead, that status and authority are clear, that the vision does not go beyond the answers given, and that agents can work without the skill installed. Distinguish files **proposed**, **generated locally** and **persisted in the repository**. Then ask for the `project_start` approval as described in [gates.md](gates.md).

### Reconciliation among the started project's documents

Before declaring the bootstrap milestone complete, confront in both directions the vision, roadmap, governance, index, catalog, decisions, future notes and any other artifact the bootstrap created or changed (the documentary reconciliation gate in [common-process.md](common-process.md), step 5). Check that undecided topics stay explicitly pending, that no document presents them as approved, that paths, states and IDs are coherent, and that cross-references point to the right destination. Fix the artifacts covered by the write authorization and re-check the result; if a needed document is not accessible or editing is not authorized, identify path, divergence and pending delta. Do not demand extra documents only to pass the gate. In a partial delivery, limit the reconciliation to what was actually produced and declare the missing sources.
