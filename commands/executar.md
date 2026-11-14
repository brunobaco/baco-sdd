---
description: Constrói as tarefas da entrega, com testes, e segue sozinho pela revisão do PR até a entrega ficar pronta para testar; retoma de onde parou.
argument-hint: "[número da entrega, ex.: ENT-001]"
disable-model-invocation: true
---

Use the BACO-SDD skill: read `${CLAUDE_PLUGIN_ROOT}/skills/baco-sdd/SKILL.md` first; its startup checks, core rules and gates apply.

Go to phase 6: read `${CLAUDE_PLUGIN_ROOT}/skills/baco-sdd/references/implementation.md` and follow it. Check its inputs first; if one is missing, say so in plain words and offer the phase that produces it.

If the delivery's `progresso.md` has a filled `## Retomada` section, this is a resume: continue from it (implementation.md, section 10). "continuar" with no delivery number means the delivery whose `## Retomada` is not `fim` (with more than one, ask which). If the situation is `rodando` with an update under 6 hours old, ask the user whether another session is still running before taking over.

The user's request: $ARGUMENTS

If the request is empty, ask in one plain question what they want to do.
