# Phase 2: Change an approved or implemented spec

Load this reference with [spec-model.md](spec-model.md) when a spec that is already `Aprovada` (or implemented) must change, and whenever a phase finds that a spec changed under a plan or an execution. The evolution procedure itself (impact analysis, before/after per behavior, preserved IDs) is in [spec-model.md](spec-model.md); this file adds versioning, the catalog distance, and what happens to plans and running work.

## 1. Evolve: new version in place

1. Impact analysis first ([common-process.md](common-process.md), step 4, evolution; [review-protocol.md](review-protocol.md)): behaviors modified, preserved, new or discontinued; effects on adjacent specs, QA, policies, permissions and journeys.
2. Before asking for approval, re-read the WHOLE spec for consistency with the change, not only the edited sections: scope, concepts and glossary, flows, rules, traceability, examples and the entry block. A new rule often leaves an old sentence, an example or a CA contradicting it. Adjust what else needs it and list those adjustments in the delta, apart from the requested change. Then run the role [cold-reader](roles/cold-reader.md) on the new version as for any spec ([spec-model.md](spec-model.md)).
3. Present the editable delta (the change and the other adjustments) and ask for `spec_approval` ([gates.md](gates.md)). An evolution is approved like a new spec; a recommendation never counts as approval.
4. Write the new version **in the same file**: `spec-<nome>.md` is never copied to `spec-<nome>-v2.md`. Bump the metadata version (for example `2.0` → `2.1`) and add one row with the same version to the versions table (the history table). Earlier rows are never rewritten or deleted.
5. The row lists what changed **by ID**: `RN-EMP-004 modificada`, `CA-EMP-015 nova`, `CA-EMP-007 removida`. The spec describes only the current contract: a removed or superseded item leaves the body, with no table of retired IDs; Git keeps the earlier text and `baco spec-diff` reports it. Take new numbers from the metadata line `Próximos números livres` and advance it in the same edit; never reuse a number, even one retired several versions ago. A project whose convention keeps retired items in the body keeps doing so; for compatibility, the engine reads a table row whose `Situação` column says `obsoleto`, `substituído`, `revogado` or `retirado` as a retired ID, never as a definition.
6. Review the QA file against the new version: update `Versão da spec`, adjust the scenarios of modified CAs, add scenarios for new CAs, retire scenarios of removed CAs, and update the QA's `Situação do QA` line with the spec version it was checked against and the result (for example `revisado para a versão 2.1 da spec, sem alterações` when nothing changes materially).
7. Review the entry block (`## Porta de entrada`) against the new contract and update it; add it if the spec has none (section 5, same version).
8. Run `baco validate-spec <spec>` (exit 0 required; `VERSION_MISMATCH` means the metadata version and the last history row differ). If the version before the change already failed, list those findings in the delta as their own adjustment and fix them in this version when the user agrees; otherwise require no new finding, as in section 5, "When the engine's proof falls short".

A full rewrite of the file to change a few rules is not an evolution; keep the existing structure, headings and IDs of the project.

## 2. The catalog shows the distance

The catalog is the only source of the state of reality. After an evolution:
- `Versão` and `Situação documental` show the approved version (for example `2.1`, `Aprovada`), edited by hand;
- `Versão implementada` keeps what the code really has (for example `2.0 @ abc1234 (ENT-002)`), written only by the reconciliation phase through `baco catalog set <CODE> --implemented <version>@<sha>@<ENT-NNN>`;
- `Versão validada` likewise stays at what was validated.

Never move `Implementação` or `Validação` because the spec changed; `baco catalog get <CODE>` reads the row. Approved `2.1` with implemented `2.0` is a normal, honest state: the next delivery closes the distance.

## 3. Plan only the difference

Run:

```
baco spec-diff <spec> --base auto
```

`--base auto` takes the sha from the catalog's `Versão implementada` for the spec's code and compares the spec at that commit with the working file, item by item by ID. It lists `added`, `modified` and `removed` definitions (RF, RNF, RN, INV, CA). With no implemented version recorded, or a spec that did not exist at that commit, everything is reported as `added` (a first delivery). `--base <ref>` compares against an explicit ref instead.

- The plan and its tasks cover only that list (the planning phase, `planning.md`, uses it as the delivery cut).
- Do not mine the Git history by yourself to find what changed; the diff is the source.
- A modified ID whose text changed only cosmetically still appears; judge it per behavior and say which entries need no work.

Tests: the test of a CA **modified or removed in the spec** may be changed, because the spec says so (the implementation phase passes `--allow-from-spec <spec>@<ref>` to `baco guard-tests`). Every other tagged test keeps the rule that tests are never loosened.

## 4. Spec changed along the way

**Freeze.** With `planning.freeze_specs` on (default), a spec change after the plan is approved goes to the next delivery: the current delivery keeps the planned version, and the catalog shows the new version as ahead of `Versão implementada`. Only when the person decides to bring it in, asked once with the cost in plain words (which tasks reopen, which released tests change), does the rest of this section apply. With `freeze_specs: false`, it applies as written.

**Plan made, not yet executed.** The plan header records `**Specs:** path@version`. Run:

```
baco plan-freshness <ENT-NNN>
```

Exit 0: the plan is fresh. Exit 1: the plan is **stale** (`stale` lists `path`, `planned` and `current` versions; a missing file or unparsable version also counts as stale; a plan with no specs listed fails too). A stale plan is not executed: mark it stale and replan only the difference between the planned and the current version, then go back to the `plan` gate. The procedure (finding the commit that holds the planned version, then `baco spec-diff <spec> --base <sha>`) is in [planning.md](planning.md), "Re-planning a stale plan"; do not use `--base auto` for it.

**Execution in progress.** Stop the execution and ask the human to choose; never decide alone (with the freeze on, ask once, as above, and say that option 1 is the default):

> A spec [nome] mudou da versão [X] para a [Y] enquanto esta entrega estava em andamento. Posso: (1) **terminar na versão [X]** e deixar a mudança para uma próxima entrega, ou (2) **parar e replanejar agora** para incluir a mudança, o que reabre [tarefas] e libera [testes]. O que prefere?

Record the choice in the delivery's `progresso.md`. With (1), the plan keeps its header and the catalog will show `Versão implementada` at `X`; with (2), update the plan header, replan the difference and pass the `plan` gate again.

## 5. Add the entry block to an existing spec

An existing spec without `## Porta de entrada` ([spec-model.md](spec-model.md), "Entry block") gets it in one of two ways, never imposed.

**Inside a real evolution (default).** When the spec is evolved for another reason (section 1), offer the block once; accepted, it goes into that same version, with no extra history row, version step or approval round. Offer:

> Esta spec não tem a porta de entrada (o resumo de 5 linhas no topo). Aproveito esta mudança para acrescentar? Não muda nenhuma regra.

If the user refuses, append "sem porta de entrada, por escolha" to the `Resumo` cell of the spec's catalog row and never offer it again for that spec unless the user asks. Before offering, check that cell.

**In a batch, only when the user asks.** Then each spec gets its own new version:
- One history row `Porta de entrada adicionada, sem mudança de contrato.` with the smallest version step the project's governance allows (if governance is silent, propose the smallest step and ask). The metadata version equals the new row; `baco validate-spec <spec>` must exit 0, or, when the version before the edit already fails, report no finding that version did not have (see "When the engine's proof falls short" below).
- Proof: `baco spec-diff <spec> --base <commit before the edit>` lists nothing added, modified or removed, and `git diff <commit before the edit> -- <spec>` removes no line except the metadata version row (everything else is added). Otherwise undo and redo. IDs listed under `reclassified` do not count as removed or added: their text did not change, only how the engine reads it.
- In the QA file change only `Versão da spec` and the `Situação do QA` line (section 1, step 6), for example `revisado para a versão 1.7 da spec, sem alterações`, so reconciliation does not report a gap.
- Skip any spec cited by a plan not yet delivered: it would make `baco plan-freshness` exit 1; do it after that delivery.
- One spec per commit on a `docs/<nome>` branch; present all blocks together for one `spec_approval` round ([gates.md](gates.md)), listing each spec's version step. After the "sim", update `Versão` in the catalog; the distance to `Versão implementada` carries no work.

**Both ways.** The edit is additive only: insert the block before the first section; do not rewrite, split, reorder or reformat anything; keep headings, IDs and the project's version scheme; QA scenarios stay as they are. Take the content from the spec's own goal, scope and exclusions and from sources it cites; never invent; no IDs; with no business metric, write `a definir`.

**When the engine's proof falls short.** Before editing, run `baco validate-spec` on the spec as it is and read `counts` and the findings.
- The spec already fails before any edit (exit 1 from content kept as history or from a shape the engine does not read): do not fix it inside this batch, because that changes content. Write the earlier version to a temporary folder outside the repository (`git show <commit before the edit>:<spec> > <tmp>/before.md`), run `baco validate-spec <tmp>/before.md`, and require the new version to have the same findings and no new one, compared by code and ID. Tell the user which findings were already there and offer to fix them in a separate evolution (section 1).
- `NO_DEFINITIONS`, `UNRECOGNIZED_DEFINITION`, or `counts` clearly lower than the IDs written as definitions: the engine is not reading the items, so an empty `spec-diff` proves nothing; never present it as proof. Rely on the line-level proof alone, say in the delta that the item-by-item check was not possible and why, and offer to convert the items to a recognized shape ([spec-model.md](spec-model.md), engine-readable shapes) as its own evolution, with its own version and approval. For that conversion, the proof is that the set of IDs in the text is the same before and after and that `counts` now matches it; `spec-diff` against the version before the conversion is expected to differ.
- `spec-diff` lists items as removed or modified while the line-level diff shows their text untouched: the engine read the same text differently. Do not undo; report the IDs as an engine reading difference and keep the line-level proof.

## Talking to the user

Say "versão da spec" and "o que mudou desde a última versão implementada"; never "diff", "sha" or "commit" without a plain explanation. Keep proposto / alterado / verificado distinct: a delta shown is proposed, a file written is changed, a re-run `baco validate-spec` with exit 0 is verified.
