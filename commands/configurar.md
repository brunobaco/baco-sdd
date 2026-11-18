---
description: Configura o BACO neste projeto, explicando cada opção: idioma, branches, paradas para aprovação, testes, ferramentas e modelos de IA, revisão.
argument-hint: "[o que você quer ajustar]"
disable-model-invocation: true
---

Use the BACO-SDD skill: read `${CLAUDE_PLUGIN_ROOT}/skills/baco-sdd/SKILL.md` first; its startup checks, core rules and gates apply.

Go to phase 0 (in a new project, the initial commit and the integration branch come before any file is written, and the setup files are written on the short-lived branch `baco/configuracao`, cut from the integration branch and merged into it): read `${CLAUDE_PLUGIN_ROOT}/skills/baco-sdd/references/configure.md` and follow it. Check its inputs first; if one is missing, say so in plain words and offer the phase that produces it.

Claude Code only: if `~/.claude/settings.json` has no `Read(~/.claude/plugins/cache/baco-sdd/**)` in `permissions.allow`, explain in one sentence why the skill needs it and ask before adding it; change nothing else in that file.

The user's request: $ARGUMENTS

If the request is empty, ask in one plain question what they want to do.
