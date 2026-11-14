---
description: Cria, confere ou muda uma spec (o contrato do que o produto faz).
argument-hint: "[o que você quer especificar ou mudar]"
disable-model-invocation: true
---

Use the BACO-SDD skill: read `${CLAUDE_PLUGIN_ROOT}/skills/baco-sdd/SKILL.md` first; its startup checks, core rules and gates apply.

Go to phase 2: use the phase router in `${CLAUDE_PLUGIN_ROOT}/skills/baco-sdd/SKILL.md` to pick criar, auditar or evoluir, then read the references it names.

The user's request: $ARGUMENTS

If the request is empty, ask in one plain question what they want to do.
