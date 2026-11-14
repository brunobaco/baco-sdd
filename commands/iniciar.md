---
description: Começa um projeto novo ou organiza a documentação que já existe.
argument-hint: "[nome ou ideia do produto]"
disable-model-invocation: true
---

Use the BACO-SDD skill: read `${CLAUDE_PLUGIN_ROOT}/skills/baco-sdd/SKILL.md` first; its startup checks, core rules and gates apply.

Go to phase 1: read `${CLAUDE_PLUGIN_ROOT}/skills/baco-sdd/references/project-bootstrap.md` and follow it. Check its inputs first; if one is missing, say so in plain words and offer the phase that produces it.

The user's request: $ARGUMENTS

If the request is empty, ask in one plain question what they want to do.
