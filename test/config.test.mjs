import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseYamlSubset, loadConfig, manualPendingRule, DEFAULTS, MANDATORY_GATES, ConfigError,
  testLayers, layerCommand, queuedLayers, smokeCommand,
} from '../skills/baco-sdd/scripts/lib/config.mjs';
import { t } from '../skills/baco-sdd/scripts/lib/messages.mjs';

const DESIGN_YAML = `language: pt-BR
tracker: [files, github]
branches:
  main: main
  integration: develop
  protected: [main, master, develop]
parallel: 3            # 0 = sequencial
gates:
  project_start: on
  architecture: on
  plan: on
  task_batch: on
  each_task: off
  before_pr: on
  # spec_approval, irreversible_action, merge_main: sempre on
manual_pending:        # cenário manual sem execução confirmada
  main: block
  develop: warn
tests:                 # comandos que geram JUnit XML
  unit: "npm test -- --reporter=junit"
  e2e_web: "npx playwright test --reporter=junit"
models:                # classe de tarefa → implementador
  mechanical: { model: haiku,  effort: low }
  standard:   { model: sonnet, effort: medium }   # provisório, ver §9
  risky:      { model: opus,   effort: medium }
review:
  external_rounds_max: 3
`;

function rootWith(yaml) {
  const root = mkdtempSync(join(tmpdir(), 'baco-cfg-'));
  if (yaml !== undefined) {
    mkdirSync(join(root, '.baco'));
    writeFileSync(join(root, '.baco', 'config.yaml'), yaml);
  }
  return root;
}

test('parses the design section 6 example', () => {
  const c = parseYamlSubset(DESIGN_YAML);
  assert.equal(c.parallel, 3);
  assert.deepEqual(c.tracker, ['files', 'github']);
  assert.equal(c.models.risky.model, 'opus');
  assert.equal(c.models.mechanical.effort, 'low');
  assert.equal(c.gates.each_task, false);
  assert.equal(c.gates.plan, true);
  assert.equal(c.tests.unit, 'npm test -- --reporter=junit');
  assert.equal(c.manual_pending.develop, 'warn');
  assert.deepEqual(c.branches.protected, ['main', 'master', 'develop']);
});

test('block lists, quotes and hash inside quotes', () => {
  assert.deepEqual(parseYamlSubset('a:\n  - x\n  - y'), { a: ['x', 'y'] });
  assert.deepEqual(parseYamlSubset('a: "x # y"  # c\nb: \'q\'\nc: -1.5'), { a: 'x # y', b: 'q', c: -1.5 });
});

test('tab indentation throws ConfigError with line', () => {
  assert.throws(() => parseYamlSubset('a:\n\tb: 1'), (e) => e instanceof ConfigError && e.line === 2);
});

test('malformed line throws ConfigError', () => {
  assert.throws(() => parseYamlSubset('a: 1\njust text'), (e) => e instanceof ConfigError && e.line === 2);
});

test('missing file yields defaults', () => {
  const cfg = loadConfig(rootWith());
  assert.equal(cfg.parallel, 3);
  assert.deepEqual(cfg.warnings, []);
  assert.deepEqual(cfg.gates, DEFAULTS.gates);
});

test('deep merge: maps merge, arrays replace', () => {
  const cfg = loadConfig(rootWith('tracker: [github]\nbranches:\n  integration: dev\nparallel: 0\n'));
  assert.deepEqual(cfg.tracker, ['github']);
  assert.equal(cfg.branches.integration, 'dev');
  assert.equal(cfg.branches.main, 'main');
  assert.equal(cfg.parallel, 0);
});

test('mandatory gate off is dropped with a warning', () => {
  const cfg = loadConfig(rootWith('gates:\n  merge_main: off\n'));
  assert.notEqual(cfg.gates.merge_main, false);
  assert.equal(cfg.warnings.length, 1);
  assert.equal(cfg.warnings[0].key, 'config.mandatory_gate_ignored');
  assert.equal(cfg.warnings[0].params.gate, 'merge_main');
  assert.ok(MANDATORY_GATES.includes('merge_main'));
});

test('manualPendingRule: exact key then wildcard', () => {
  const cfg = loadConfig(rootWith());
  assert.equal(manualPendingRule(cfg, 'main'), 'block');
  assert.equal(manualPendingRule(cfg, 'develop'), 'warn');
  assert.equal(manualPendingRule({ manual_pending: { main: 'block' } }, 'x'), 'warn');
});

test('invalid file raises ConfigError', () => {
  assert.throws(() => loadConfig(rootWith('a: 1\n\tb: 2')), ConfigError);
});

test('URL value with # but no preceding space is kept', () => {
  assert.equal(parseYamlSubset('u: https://x/a#b').u, 'https://x/a#b');
});

test('empty values keep defaults', () => {
  const cfg = loadConfig(rootWith('gates:\ntracker:\nbranches:\n  main:\n'));
  assert.deepEqual(cfg.gates, DEFAULTS.gates);
  assert.deepEqual(cfg.tracker, ['files']);
  assert.equal(cfg.branches.main, 'main');
});

test('inline map with array replaces default array', () => {
  const cfg = loadConfig(rootWith('branches: { protected: [main] }\n'));
  assert.deepEqual(cfg.branches.protected, ['main']);
  assert.equal(cfg.branches.integration, 'develop');
});

test('manualPendingRule: prototype-named branches fall to wildcard, never inherited values', () => {
  const cfg = { manual_pending: { main: 'block', '*': 'warn' } };
  for (const b of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) assert.equal(manualPendingRule(cfg, b), 'warn');
  assert.equal(manualPendingRule({ manual_pending: { main: 'block' } }, 'constructor'), 'warn');
});

// I3: mandatory gates are always true; non-map sections are ignored with a warning.
test('I3: mandatory gates resolve to true whatever the user writes', () => {
  for (const v of ['"off"', '0', 'no', 'off', 'false', '"true"', '[]']) {
    const cfg = loadConfig(rootWith(`gates:\n  merge_main: ${v}\n  spec_approval: ${v}\n`));
    for (const g of MANDATORY_GATES) assert.equal(cfg.gates[g], true, `${g} with ${v}`);
    assert.deepEqual(cfg.warnings.map((w) => [w.key, w.params.gate]),
      [['config.mandatory_gate_ignored', 'spec_approval'], ['config.mandatory_gate_ignored', 'merge_main']], v);
  }
  const plain = loadConfig(rootWith());
  for (const g of MANDATORY_GATES) assert.equal(plain.gates[g], true);
  assert.deepEqual(loadConfig(rootWith('gates:\n  merge_main: true\n')).warnings, []);
});

test('I3: a non-map gates value keeps defaults with config.invalid_section', () => {
  for (const v of ['off', '0', 'no', '[a]']) {
    const cfg = loadConfig(rootWith(`gates: ${v}\n`));
    assert.equal(cfg.gates.plan, true, v);
    for (const g of MANDATORY_GATES) assert.equal(cfg.gates[g], true);
    assert.deepEqual(cfg.warnings, [{ key: 'config.invalid_section', params: { section: 'gates' } }], v);
  }
});

test('I3: non-map protection for branches, tests, models, review and manual_pending', () => {
  for (const section of ['branches', 'tests', 'models', 'review', 'manual_pending']) {
    const cfg = loadConfig(rootWith(`${section}: off\n`));
    assert.deepEqual(cfg[section], { ...DEFAULTS, gates: undefined }[section], section);
    assert.deepEqual(cfg.warnings, [{ key: 'config.invalid_section', params: { section } }], section);
  }
});

test('I3: scalar branches.protected and tests.patterns become one-element arrays', () => {
  const cfg = loadConfig(rootWith('branches:\n  protected: trunk\ntests:\n  patterns: "**/*.t.js"\n'));
  assert.deepEqual(cfg.branches.protected, ['trunk']);
  assert.deepEqual(cfg.tests.patterns, ['**/*.t.js']);
});

// I4: `main` and `integration` keys are roles resolved through config.branches.
test('I4: manual_pending role keys resolve through branches; literal names win; * falls back', () => {
  const cfg = loadConfig(rootWith('branches: {main: master}\n'));
  assert.equal(manualPendingRule(cfg, 'master'), 'block');
  assert.equal(manualPendingRule(cfg, 'main'), 'warn');
  const lit = loadConfig(rootWith('branches: {main: master, integration: dev}\nmanual_pending:\n  master: warn\n  integration: block\n'));
  assert.equal(manualPendingRule(lit, 'master'), 'warn');
  assert.equal(manualPendingRule(lit, 'dev'), 'block');
  assert.equal(manualPendingRule(lit, 'feature'), 'warn');
});

// Model levels: roles name a level (forte|medio|leve) and an effort (alto|medio|baixo), never a model.
test('models: defaults are levels, not model names', () => {
  assert.deepEqual(DEFAULTS.models, {
    mechanical: { level: 'leve', effort: 'baixo' },
    standard: { level: 'medio', effort: 'medio' },
    risky: { level: 'forte', effort: 'medio' },
  });
  assert.deepEqual(loadConfig(rootWith()).models, DEFAULTS.models);
});

test('models: the new form loads, in any case and with accents', () => {
  const cfg = loadConfig(rootWith('models:\n  mechanical: { level: Médio, effort: ALTO }\n  risky: { level: forte, effort: baixo }\n'));
  assert.deepEqual(cfg.models.mechanical, { level: 'medio', effort: 'alto' });
  assert.deepEqual(cfg.models.risky, { level: 'forte', effort: 'baixo' });
  assert.deepEqual(cfg.models.standard, DEFAULTS.models.standard);
  assert.deepEqual(cfg.warnings, []);
});

test('models: the old form keeps loading, mapped to levels', () => {
  const cfg = loadConfig(rootWith('models:\n  mechanical: { model: opus, effort: high }\n  standard: { model: haiku, effort: low }\n  risky: { model: sonnet, effort: medium }\n'));
  assert.deepEqual(cfg.models.mechanical, { level: 'forte', effort: 'alto' });
  assert.deepEqual(cfg.models.standard, { level: 'leve', effort: 'baixo' });
  assert.deepEqual(cfg.models.risky, { level: 'medio', effort: 'medio' });
  assert.deepEqual(cfg.warnings, []);
  for (const e of ['xhigh', 'max']) {
    assert.equal(loadConfig(rootWith(`models:\n  risky: { model: opus, effort: ${e} }\n`)).models.risky.effort, 'alto', e);
  }
});

test('models: level wins over model; a half-specified class keeps the default for the rest', () => {
  const both = loadConfig(rootWith('models:\n  risky: { level: leve, model: opus, effort: baixo }\n'));
  assert.deepEqual(both.models.risky, { level: 'leve', effort: 'baixo' });
  const half = loadConfig(rootWith('models:\n  risky: { level: medio }\n'));
  assert.deepEqual(half.models.risky, { level: 'medio', effort: 'medio' });
  assert.deepEqual(half.warnings, []);
  assert.deepEqual(loadConfig(rootWith('models:\n  risky: { model: haiku }\n')).models.risky, { level: 'leve', effort: 'medio' });
});

test('models: invalid values warn in the existing style and keep the default for that field', () => {
  const cfg = loadConfig(rootWith('models:\n  risky: { level: gigante, effort: baixo }\n  standard: { model: gpt, effort: enorme }\n  mechanical: off\n'));
  assert.deepEqual(cfg.models.risky, { level: 'forte', effort: 'baixo' });
  assert.deepEqual(cfg.models.standard, DEFAULTS.models.standard);
  assert.deepEqual(cfg.models.mechanical, DEFAULTS.models.mechanical);
  assert.deepEqual(cfg.warnings, [
    { key: 'config.invalid_section', params: { section: 'models.mechanical' } },
    { key: 'config.invalid_section', params: { section: 'models.standard.model' } },
    { key: 'config.invalid_section', params: { section: 'models.standard.effort' } },
    { key: 'config.invalid_section', params: { section: 'models.risky.level' } },
  ]);
});

test('models: the pt-BR template loads without warnings and equals the defaults', () => {
  const text = readFileSync(new URL('../skills/baco-sdd/templates/pt-BR/config.yaml', import.meta.url), 'utf8');
  const cfg = loadConfig(rootWith(text));
  assert.deepEqual(cfg.models, DEFAULTS.models);
  assert.deepEqual(cfg.warnings, []);
  // The models section speaks of levels only; model names live under harnesses.
  const models = text.slice(text.indexOf('\nmodels:') + 1);
  assert.doesNotMatch(models.slice(0, models.search(/\n(?=[^\s#])/)), /opus|sonnet|haiku/);
});

// run-tests: tests_quick, app.smoke and tests.queue.
test('testLayers lists the command keys of tests (not junit_dir, patterns, queue); quick adds tests_quick-only layers', () => {
  const cfg = loadConfig(rootWith('tests:\n  junit_dir: out\n  unit: "u"\n  e2e_web: "w"\n  queue: [unit]\ntests_quick:\n  e2e_web: "wq"\n  extra: "x"\n'));
  assert.deepEqual(testLayers(cfg), ['unit', 'e2e_web']);
  assert.deepEqual(testLayers(cfg, { quick: true }), ['unit', 'e2e_web', 'extra']);
  assert.deepEqual(testLayers(loadConfig(rootWith())), []);
});

test('layerCommand: quick falls back to tests; unknown layer is undefined; no command is null', () => {
  const cfg = loadConfig(rootWith('tests:\n  unit: "u"\n  e2e_web: "w"\n  odd: [a]\ntests_quick:\n  e2e_web: "wq"\n  extra: "x"\n'));
  assert.equal(layerCommand(cfg, 'unit'), 'u');
  assert.equal(layerCommand(cfg, 'unit', true), 'u');
  assert.equal(layerCommand(cfg, 'e2e_web', true), 'wq');
  assert.equal(layerCommand(cfg, 'e2e_web', false), 'w');
  assert.equal(layerCommand(cfg, 'extra', true), 'x');
  assert.equal(layerCommand(cfg, 'extra', false), null);
  assert.equal(layerCommand(cfg, 'odd'), null);
  assert.equal(layerCommand(cfg, 'nope'), undefined);
  for (const reserved of ['junit_dir', 'patterns', 'queue']) assert.equal(layerCommand(cfg, reserved), undefined, reserved);
});

test('queuedLayers: default is every layer starting with e2e; tests.queue replaces it (scalar ok, [] disables)', () => {
  assert.deepEqual(queuedLayers(loadConfig(rootWith('tests:\n  unit: "u"\n  e2e_web: "w"\n  e2e_mobile: "m"\n'))), ['e2e_web', 'e2e_mobile']);
  assert.deepEqual(queuedLayers(loadConfig(rootWith('tests:\n  unit: "u"\ntests_quick:\n  e2e_x: "q"\n'))), ['e2e_x']);
  assert.deepEqual(queuedLayers(loadConfig(rootWith('tests:\n  unit: "u"\n  queue: unit\n'))), ['unit']);
  assert.deepEqual(queuedLayers(loadConfig(rootWith('tests:\n  e2e_web: "w"\n  queue: []\n'))), []);
});

test('smokeCommand reads app.smoke; tests_quick and app must be maps', () => {
  assert.equal(smokeCommand(loadConfig(rootWith('app:\n  smoke: "npm run smoke"\n'))), 'npm run smoke');
  assert.equal(smokeCommand(loadConfig(rootWith())), null);
  assert.equal(smokeCommand(loadConfig(rootWith('app:\n  smoke: [a]\n'))), null);
  for (const section of ['tests_quick', 'app']) {
    const cfg = loadConfig(rootWith(`${section}: off\n`));
    assert.equal(cfg[section], undefined, section);
    assert.deepEqual(cfg.warnings, [{ key: 'config.invalid_section', params: { section } }], section);
  }
});

// 0.1.1: provenance.ignore, paths that do not make a recorded head stale (atrito 1).
test('provenance.ignore: default empty; list or scalar of paths; leading ./ dropped', () => {
  assert.deepEqual(loadConfig(rootWith()).provenance, { ignore: [] });
  assert.deepEqual(DEFAULTS.provenance, { ignore: [] });
  const list = loadConfig(rootWith('provenance:\n  ignore:\n    - docs/registro-da-rodada.md\n    - "logs/**"\n'));
  assert.deepEqual(list.provenance.ignore, ['docs/registro-da-rodada.md', 'logs/**']);
  assert.deepEqual(list.warnings, []);
  assert.deepEqual(loadConfig(rootWith('provenance:\n  ignore: ./logs/**\n')).provenance.ignore, ['logs/**']);
  assert.deepEqual(loadConfig(rootWith('provenance:\n')).provenance, { ignore: [] });
});

test('provenance.ignore: a non-list or non-map shape, or bad items, warn in the existing style', () => {
  const offSection = loadConfig(rootWith('provenance: off\n'));
  assert.deepEqual(offSection.provenance, { ignore: [] });
  assert.deepEqual(offSection.warnings, [{ key: 'config.invalid_section', params: { section: 'provenance' } }]);
  const mapValue = loadConfig(rootWith('provenance:\n  ignore: {a: b}\n'));
  assert.deepEqual(mapValue.provenance.ignore, []);
  assert.deepEqual(mapValue.warnings, [{ key: 'config.invalid_section', params: { section: 'provenance.ignore' } }]);
  // Bad items are dropped (the good ones stay): not text, empty, absolute, or with pathspec magic.
  const items = loadConfig(rootWith('provenance:\n  ignore: [logs/**, {a: b}, "", /etc/x, ":(glob)x", true]\n'));
  assert.deepEqual(items.provenance.ignore, ['logs/**']);
  assert.deepEqual(items.warnings, [{ key: 'config.invalid_section', params: { section: 'provenance.ignore' } }]);
});

// 0.1.1 review: an entry that would hide code, tests or the engine's own files is dropped with a warning.
test('provenance.ignore: too broad, outside the repo, .baco or test-covering entries are dropped with one warning', () => {
  const warn = [{ key: 'config.invalid_section', params: { section: 'provenance.ignore' } }];
  const check = (entries, kept, extra = '') => {
    const cfg = loadConfig(rootWith(`${extra}provenance:\n  ignore:\n${['logs/**', ...entries].map((e) => `    - "${e}"\n`).join('')}`));
    assert.deepEqual(cfg.provenance.ignore, ['logs/**', ...kept], entries.join(' '));
    assert.deepEqual(cfg.warnings, kept.length === entries.length ? [] : warn, entries.join(' '));
  };
  // Made only of wildcards, dots and slashes.
  for (const e of ['**', '*', '**/*', '.', './', '/', '*/**', '?', '**/', '..']) check([e], []);
  // `..` segments (outside the repo, or a way around the other checks).
  for (const e of ['../x', 'a/../b', 'logs/..', 'a/../../x']) check([e], []);
  // The engine's own folder and the config file itself.
  for (const e of ['.baco/config.yaml', '.baco/**', '.baco', '.baco/', '**/*.yaml', '*/config.yaml', '**/config.yaml', '.baco/junit/**']) check([e], []);
  // Paths a test pattern covers (defaults: **/*.test.*, **/*.spec.*, **/e2e/**, .maestro/**).
  for (const e of ['e2e/**', 'src/e2e/**', '**/*.test.*', '**/*.js', 'src/a.test.js', '.maestro/**', '**/*.spec.ts', 'e2e']) check([e], []);
  // Character classes and escapes are not supported by the check: rejected.
  for (const e of ['[e]2e/**', 'logs\\\\x']) check([e], []);
  // Plain files and folder globs away from tests and .baco stay.
  check(['docs/registros/**', 'docs/registro-da-rodada.md', '**/*.log', 'tmp/out/**', '*.md'], ['docs/registros/**', 'docs/registro-da-rodada.md', '**/*.log', 'tmp/out/**', '*.md']);
  // The project's own test patterns count too, and the defaults always do.
  const custom = 'tests:\n  patterns: ["checks/**"]\n';
  check(['checks/**'], [], custom);
  check(['checks/a.js'], [], custom);
  check(['e2e/**'], [], custom);
  check(['docs/registros/**'], ['docs/registros/**'], custom);
});

test('the pt-BR template documents provenance.ignore and loads to the defaults', () => {
  const text = readFileSync(new URL('../skills/baco-sdd/templates/pt-BR/config.yaml', import.meta.url), 'utf8');
  assert.match(text, /^provenance:/m);
  assert.match(text, /#\s*ignore:/);
  assert.deepEqual(loadConfig(rootWith(text)).provenance, { ignore: [] });
});

// context: conversation size handoff.
test('context: defaults are handoff_at 290000 and auto_handoff false', () => {
  assert.deepEqual(DEFAULTS.context, { handoff_at: 290000, auto_handoff: false });
  const cfg = loadConfig(rootWith());
  assert.deepEqual(cfg.context, { handoff_at: 290000, auto_handoff: false });
});

test('context: a positive integer handoff_at and a boolean auto_handoff load', () => {
  const cfg = loadConfig(rootWith('context:\n  handoff_at: 250000\n  auto_handoff: on\n'));
  assert.deepEqual(cfg.context, { handoff_at: 250000, auto_handoff: true });
  assert.deepEqual(cfg.warnings, []);
  assert.equal(loadConfig(rootWith('context:\n  auto_handoff: false\n')).context.handoff_at, 290000);
});

test('context: invalid values warn in the existing style and keep the default for that key', () => {
  for (const bad of ['0', '-5', '1.5', 'muito', '"300000"', '[1]']) {
    const cfg = loadConfig(rootWith(`context:\n  handoff_at: ${bad}\n  auto_handoff: on\n`));
    assert.equal(cfg.context.handoff_at, 290000, bad);
    assert.equal(cfg.context.auto_handoff, true, bad);
    assert.deepEqual(cfg.warnings, [{ key: 'config.invalid_section', params: { section: 'context.handoff_at' } }], bad);
  }
  for (const bad of ['sim', '1', '"true"']) {
    const cfg = loadConfig(rootWith(`context:\n  auto_handoff: ${bad}\n`));
    assert.equal(cfg.context.auto_handoff, false, bad);
    assert.deepEqual(cfg.warnings, [{ key: 'config.invalid_section', params: { section: 'context.auto_handoff' } }], bad);
  }
  const scalar = loadConfig(rootWith('context: 5\n'));
  assert.deepEqual(scalar.context, DEFAULTS.context);
  assert.deepEqual(scalar.warnings, [{ key: 'config.invalid_section', params: { section: 'context' } }]);
});

test('the pt-BR template documents context and loads to the defaults', () => {
  const text = readFileSync(new URL('../skills/baco-sdd/templates/pt-BR/config.yaml', import.meta.url), 'utf8');
  assert.match(text, /^context:/m);
  assert.match(text, /handoff_at: 290000/);
  assert.match(text, /auto_handoff: off/);
  const cfg = loadConfig(rootWith(text));
  assert.deepEqual(cfg.context, DEFAULTS.context);
  assert.deepEqual(cfg.warnings, []);
});

// harnesses: the AI tools available to the project, with each one's models mapped to the levels.
test('harnesses: default is an empty map; a full entry loads as written', () => {
  assert.deepEqual(DEFAULTS.harnesses, {});
  assert.deepEqual(loadConfig(rootWith()).harnesses, {});
  const cfg = loadConfig(rootWith([
    'harnesses:',
    '  claude-code:',
    '    models: { forte: opus, medio: sonnet, leve: haiku }',
    '    implementers: on',
    '  codex:',
    '    models:',
    '      forte: modelo-a',
    '      leve: modelo-c',
    '',
  ].join('\n')));
  assert.deepEqual(cfg.warnings, []);
  assert.deepEqual(cfg.harnesses, {
    'claude-code': { models: { forte: 'opus', medio: 'sonnet', leve: 'haiku' }, implementers: true, sandbox: 'rede' },
    codex: { models: { forte: 'modelo-a', leve: 'modelo-c' }, implementers: false, sandbox: 'rede' },
  });
});

test('harnesses: bad entries, levels and implementers flag warn and fall back', () => {
  const scalar = loadConfig(rootWith('harnesses: codex\n'));
  assert.deepEqual(scalar.harnesses, {});
  assert.deepEqual(scalar.warnings, [{ key: 'config.invalid_section', params: { section: 'harnesses' } }]);
  const cfg = loadConfig(rootWith([
    'harnesses:',
    '  codex: sim',
    '  opencode:',
    '    models: { forte: "", turbo: x, leve: provedor/modelo }',
    '    implementers: talvez',
    '  outro:',
    '    models: [a, b]',
    '',
  ].join('\n')));
  assert.deepEqual(cfg.harnesses, {
    opencode: { models: { leve: 'provedor/modelo' }, implementers: false, sandbox: 'rede' },
    outro: { models: {}, implementers: false, sandbox: 'rede' },
  });
  assert.deepEqual(cfg.warnings.map((w) => w.params.section), [
    'harnesses.codex', 'harnesses.opencode.models.forte', 'harnesses.opencode.models.turbo',
    'harnesses.opencode.implementers', 'harnesses.outro.models',
  ]);
});

// harnesses.<name>.sandbox: how free the tool is when it implements (protegida, rede or livre).
test('harnesses: sandbox defaults to rede and loads protegida, rede and livre as written', () => {
  for (const sandbox of ['protegida', 'rede', 'livre']) {
    const cfg = loadConfig(rootWith(`harnesses:\n  codex:\n    implementers: on\n    sandbox: ${sandbox}\n`));
    assert.equal(cfg.harnesses.codex.sandbox, sandbox, sandbox);
    assert.deepEqual(cfg.warnings, [], sandbox);
  }
  assert.equal(loadConfig(rootWith('harnesses:\n  codex:\n    implementers: on\n')).harnesses.codex.sandbox, 'rede');
});

test('harnesses: an invalid sandbox falls back to protegida (the strictest) with a warning', () => {
  const cfg = loadConfig(rootWith('harnesses:\n  codex:\n    implementers: on\n    sandbox: aberta\n  opencode:\n    sandbox: [rede]\n'));
  assert.equal(cfg.harnesses.codex.sandbox, 'protegida');
  assert.equal(cfg.harnesses.opencode.sandbox, 'protegida');
  assert.deepEqual(cfg.warnings, [
    { key: 'config.sandbox_invalid', params: { harness: 'codex', value: 'aberta' } },
    { key: 'config.sandbox_invalid', params: { harness: 'opencode', value: 'rede' } },
  ]);
  for (const lang of ['pt-BR', 'en']) assert.match(t(lang, 'config.sandbox_invalid', { harness: 'codex', value: 'aberta' }), /codex.*aberta.*protegida/s);
});

// review.pr: who reviews the delivery's pull request, and whether findings are fixed on their own.
test('review.pr: defaults are agente and auto_fix true; valid values load', () => {
  const rest = {
    task_rounds: { mechanical: 2, standard: 3, risky: 4 }, last_round_importante: 'seguir', pr: { reviewer: 'agente', auto_fix: true },
    focus: { always: [], suggestion: [] }, final_rounds_max: 2,
  };
  assert.deepEqual(DEFAULTS.review, { external_rounds_max: 3, ...rest });
  assert.deepEqual(loadConfig(rootWith('review:\n  external_rounds_max: 2\n')).review, { external_rounds_max: 2, ...rest });
  for (const reviewer of ['agente', 'pessoa', 'ambos']) {
    const cfg = loadConfig(rootWith(`review:\n  pr:\n    reviewer: ${reviewer}\n    auto_fix: off\n`));
    assert.deepEqual(cfg.review.pr, { reviewer, auto_fix: false }, reviewer);
    assert.deepEqual(cfg.warnings, [], reviewer);
  }
});

test('review.pr: an invalid reviewer falls back to pessoa (the most human) with a warning; a bad auto_fix keeps the default', () => {
  const cfg = loadConfig(rootWith('review:\n  pr:\n    reviewer: robo\n    auto_fix: sim\n'));
  assert.deepEqual(cfg.review.pr, { reviewer: 'pessoa', auto_fix: true });
  assert.deepEqual(cfg.warnings, [
    { key: 'config.pr_reviewer_invalid', params: { value: 'robo' } },
    { key: 'config.invalid_section', params: { section: 'review.pr.auto_fix' } },
  ]);
  const scalar = loadConfig(rootWith('review:\n  pr: agente\n'));
  assert.deepEqual(scalar.review.pr, { reviewer: 'pessoa', auto_fix: true });
  assert.deepEqual(scalar.warnings, [{ key: 'config.pr_reviewer_invalid', params: { value: 'agente' } }]);
  for (const lang of ['pt-BR', 'en']) assert.match(t(lang, 'config.pr_reviewer_invalid', { value: 'robo' }), /robo.*pessoa/s);
});

// review.last_round_importante: what happens to a task whose last fix round ends with only `importante` open.
test('review.last_round_importante: default seguir; seguir and parar load; anything else falls back to parar with a warning', () => {
  for (const value of ['seguir', 'parar']) {
    const cfg = loadConfig(rootWith(`review:\n  last_round_importante: ${value}\n`));
    assert.equal(cfg.review.last_round_importante, value);
    assert.deepEqual(cfg.warnings, [], value);
  }
  const bad = loadConfig(rootWith('review:\n  last_round_importante: talvez\n'));
  assert.equal(bad.review.last_round_importante, 'parar');
  assert.deepEqual(bad.warnings, [{ key: 'config.last_round_importante_invalid', params: { value: 'talvez' } }]);
  for (const lang of ['pt-BR', 'en']) assert.match(t(lang, 'config.last_round_importante_invalid', { value: 'talvez' }), /talvez.*parar/s);
});

test('review.round5_importante (1.4.0 name) still works as last_round_importante; the new name wins when both are set', () => {
  const old = loadConfig(rootWith('review:\n  round5_importante: parar\n'));
  assert.equal(old.review.last_round_importante, 'parar');
  assert.equal(old.review.round5_importante, undefined);
  assert.deepEqual(old.warnings, []);
  const both = loadConfig(rootWith('review:\n  round5_importante: parar\n  last_round_importante: seguir\n'));
  assert.equal(both.review.last_round_importante, 'seguir');
  assert.equal(both.review.round5_importante, undefined);
  const badOld = loadConfig(rootWith('review:\n  round5_importante: talvez\n'));
  assert.equal(badOld.review.last_round_importante, 'parar');
  assert.deepEqual(badOld.warnings, [{ key: 'config.last_round_importante_invalid', params: { value: 'talvez' } }]);
});

// review.task_rounds: the project's default maximum of fix rounds per task class; the plan may change it per delivery.
test('review.task_rounds: defaults 2, 3 and 4; a class set alone keeps the others; a bad value keeps that class default with a warning', () => {
  assert.deepEqual(DEFAULTS.review.task_rounds, { mechanical: 2, standard: 3, risky: 4 });
  const one = loadConfig(rootWith('review:\n  task_rounds: { risky: 5 }\n'));
  assert.deepEqual(one.review.task_rounds, { mechanical: 2, standard: 3, risky: 5 });
  assert.deepEqual(one.warnings, []);
  const bad = loadConfig(rootWith('review:\n  task_rounds: { mechanical: 0, standard: tres, risky: 4 }\n'));
  assert.deepEqual(bad.review.task_rounds, { mechanical: 2, standard: 3, risky: 4 });
  assert.deepEqual(bad.warnings, [
    { key: 'config.invalid_section', params: { section: 'review.task_rounds.mechanical' } },
    { key: 'config.invalid_section', params: { section: 'review.task_rounds.standard' } },
  ]);
  const scalar = loadConfig(rootWith('review:\n  task_rounds: 3\n'));
  assert.deepEqual(scalar.review.task_rounds, { mechanical: 2, standard: 3, risky: 4 });
  assert.deepEqual(scalar.warnings, [{ key: 'config.invalid_section', params: { section: 'review.task_rounds' } }]);
});

test('the pt-BR template documents harnesses and review.pr and loads without warnings', () => {
  const text = readFileSync(new URL('../skills/baco-sdd/templates/pt-BR/config.yaml', import.meta.url), 'utf8');
  assert.match(text, /^harnesses:/m);
  assert.match(text, /^ {2}pr:/m);
  assert.match(text, /reviewer: agente/);
  assert.match(text, /auto_fix: on/);
  assert.match(text, /last_round_importante: seguir/);
  assert.match(text, /task_rounds: \{ mechanical: 2, standard: 3, risky: 4 \}/);
  const cfg = loadConfig(rootWith(text));
  assert.deepEqual(cfg.warnings, []);
  assert.deepEqual(cfg.review.pr, DEFAULTS.review.pr);
  assert.equal(cfg.harnesses['claude-code'].implementers, true);
});

// 1.2.0: github.project, the GitHub Project board that mirrors the delivery's tasks.
test('github.project: unset by default; a full entry resolves with the default columns', async () => {
  const { githubProject, BOARD_STATUS_DEFAULTS } = await import('../skills/baco-sdd/scripts/lib/config.mjs');
  assert.deepEqual(BOARD_STATUS_DEFAULTS, { published: 'Backlog', started: 'In progress', review: 'In review', merged: 'Done' });
  assert.equal(githubProject(loadConfig(rootWith())), null);
  const cfg = loadConfig(rootWith('tracker: [files, github]\ngithub:\n  project: {owner: acme, number: 7}\n'));
  assert.deepEqual(cfg.warnings, []);
  assert.deepEqual(githubProject(cfg), { owner: 'acme', number: 7, field: 'Status', status: BOARD_STATUS_DEFAULTS });
  // Without the github tracker the board is not used.
  assert.equal(githubProject(loadConfig(rootWith('github:\n  project: {owner: acme, number: 7}\n'))), null);
});

test('github.project: own field and columns; a partial status map keeps the other defaults', async () => {
  const { githubProject } = await import('../skills/baco-sdd/scripts/lib/config.mjs');
  const cfg = loadConfig(rootWith([
    'tracker: [files, github]',
    'github:',
    '  project:',
    '    owner: "@me"',
    '    number: 3',
    '    field: Etapa',
    '    status:',
    '      started: Fazendo',
    '      merged: "Feito"',
    '',
  ].join('\n')));
  assert.deepEqual(cfg.warnings, []);
  assert.deepEqual(githubProject(cfg), {
    owner: '@me', number: 3, field: 'Etapa',
    status: { published: 'Backlog', started: 'Fazendo', review: 'In review', merged: 'Feito' },
  });
});

test('github.project: bad values warn and fall back', async () => {
  const { githubProject } = await import('../skills/baco-sdd/scripts/lib/config.mjs');
  const scalar = loadConfig(rootWith('tracker: [files, github]\ngithub: sim\n'));
  assert.equal(githubProject(scalar), null);
  assert.deepEqual(scalar.warnings.map((w) => w.params.section), ['github']);
  for (const project of ['{owner: acme}', '{owner: "", number: 7}', '{owner: acme, number: 0}', '{owner: acme, number: 2.5}', 'sete']) {
    const cfg = loadConfig(rootWith(`tracker: [files, github]\ngithub:\n  project: ${project}\n`));
    assert.equal(githubProject(cfg), null, project);
    assert.deepEqual(cfg.warnings.map((w) => w.params.section), ['github.project'], project);
  }
  const cfg = loadConfig(rootWith([
    'tracker: [files, github]',
    'github:',
    '  project:',
    '    owner: acme',
    '    number: 7',
    '    field: ""',
    '    status: {started: "", talvez: X, review: Revisando}',
    '',
  ].join('\n')));
  assert.deepEqual(githubProject(cfg), {
    owner: 'acme', number: 7, field: 'Status',
    status: { published: 'Backlog', started: 'In progress', review: 'Revisando', merged: 'Done' },
  });
  assert.deepEqual(cfg.warnings.map((w) => w.params.section), ['github.project.field', 'github.project.status.started', 'github.project.status.talvez']);
  const listStatus = loadConfig(rootWith('tracker: [files, github]\ngithub:\n  project: {owner: acme, number: 7, status: [a]}\n'));
  assert.deepEqual(listStatus.warnings.map((w) => w.params.section), ['github.project.status']);
  assert.equal(githubProject(listStatus).status.published, 'Backlog');
});

// 1.8.0: how the plan splits the tasks (planning.task_split), tool profiles (harnesses.<name>.tool)
// and the ordered reserve list of each role (roles).
test('planning.task_split: defaults to funcionalidade; front-back loads; a bad value falls back with a warning', async () => {
  assert.equal(DEFAULTS.planning.task_split, 'funcionalidade');
  assert.equal(loadConfig(rootWith()).planning.task_split, 'funcionalidade');
  const fb = loadConfig(rootWith('planning:\n  task_split: front-back\n'));
  assert.equal(fb.planning.task_split, 'front-back');
  assert.deepEqual(fb.warnings, []);
  const bad = loadConfig(rootWith('planning:\n  task_split: camadas\n'));
  assert.equal(bad.planning.task_split, 'funcionalidade');
  assert.deepEqual(bad.warnings, [{ key: 'config.task_split_invalid', params: { value: 'camadas' } }]);
  for (const lang of ['pt-BR', 'en']) assert.match(t(lang, 'config.task_split_invalid', { value: 'camadas' }), /camadas.*funcionalidade/s);
  const scalar = loadConfig(rootWith('planning: front-back\n'));
  assert.equal(scalar.planning.task_split, 'funcionalidade');
  assert.deepEqual(scalar.warnings, [{ key: 'config.invalid_section', params: { section: 'planning' } }]);
});

test('harnesses.<name>.tool: a profile names the tool it calls; the tool defaults to the name; a bad tool warns', async () => {
  const { harnessTool } = await import('../skills/baco-sdd/scripts/lib/config.mjs');
  const cfg = loadConfig(rootWith([
    'harnesses:',
    '  antigravity:',
    '    models: { forte: gemini-4-neon }',
    '  antigravity-claude:',
    '    tool: antigravity',
    '    models: { forte: claude-opus-5-5, medio: claude-sonnet-5-5 }',
    '  outro:',
    '    tool: [x]',
    '',
  ].join('\n')));
  assert.equal(cfg.harnesses['antigravity-claude'].tool, 'antigravity');
  assert.equal(harnessTool(cfg, 'antigravity-claude'), 'antigravity');
  assert.equal(harnessTool(cfg, 'antigravity'), 'antigravity');
  assert.equal(harnessTool(cfg, 'claude-code'), 'claude-code');
  assert.equal(cfg.harnesses.outro.tool, undefined);
  assert.equal(harnessTool(cfg, 'outro'), 'outro');
  assert.deepEqual(cfg.warnings, [{ key: 'config.invalid_section', params: { section: 'harnesses.outro.tool' } }]);
});

test('roles: default empty; each role is an ordered list of harness or harness/model; unknown roles and harnesses warn', async () => {
  const { roleChain, ROLE_NAMES } = await import('../skills/baco-sdd/scripts/lib/config.mjs');
  assert.deepEqual(DEFAULTS.roles, {});
  assert.deepEqual(ROLE_NAMES, ['implementer', 'backend', 'frontend', 'task_reviewer', 'task_reviewer_last', 'final_reviewer', 'pr_reviewer']);
  assert.deepEqual(roleChain(loadConfig(rootWith()), 'backend'), []);
  const cfg = loadConfig(rootWith([
    'harnesses:',
    '  claude-code:',
    '    implementers: on',
    '  codex:',
    '    models: { forte: gpt-x }',
    '  antigravity:',
    '    implementers: on',
    '    sandbox: protegida',
    '  antigravity-claude:',
    '    tool: antigravity',
    '    implementers: on',
    '    sandbox: protegida',
    'roles:',
    '  backend: [antigravity-claude, claude-code]',
    '  frontend: antigravity',
    '  task_reviewer:',
    '    - codex',
    '    - antigravity/gemini-4-argon',
    '  task_reviewer_last: [antigravity/gemini-4-argon, sumiu]',
    '  revisor_extra: [codex]',
    '  pr_reviewer: [nada]',
    '',
  ].join('\n')));
  assert.deepEqual(cfg.roles, {
    backend: ['antigravity-claude', 'claude-code'],
    frontend: ['antigravity'],
    task_reviewer: ['codex', 'antigravity/gemini-4-argon'],
    task_reviewer_last: ['antigravity/gemini-4-argon'],
  });
  assert.deepEqual(roleChain(cfg, 'backend'), [
    { harness: 'antigravity-claude', tool: 'antigravity', model: null },
    { harness: 'claude-code', tool: 'claude-code', model: null },
  ]);
  assert.deepEqual(roleChain(cfg, 'task_reviewer')[1], { harness: 'antigravity', tool: 'antigravity', model: 'gemini-4-argon' });
  assert.deepEqual(roleChain(cfg, 'pr_reviewer'), []);
  assert.deepEqual(cfg.warnings, [
    { key: 'config.role_harness_unknown', params: { role: 'task_reviewer_last', harness: 'sumiu' } },
    { key: 'config.role_unknown', params: { role: 'revisor_extra', known: ROLE_NAMES.join(', ') } },
    { key: 'config.role_harness_unknown', params: { role: 'pr_reviewer', harness: 'nada' } },
  ]);
  for (const lang of ['pt-BR', 'en']) {
    assert.match(t(lang, 'config.role_harness_unknown', { role: 'pr_reviewer', harness: 'nada' }), /pr_reviewer.*nada/s);
    assert.match(t(lang, 'config.role_unknown', { role: 'x', known: 'implementer' }), /x.*implementer/s);
  }
});

test('roles: an entry that is not text or has an empty model is dropped with a warning; a role that is not a list warns', () => {
  const cfg = loadConfig(rootWith([
    'harnesses:',
    '  codex:',
    '    models: { forte: gpt-x }',
    'roles:',
    '  task_reviewer: [codex/, codex]',
    '  final_reviewer: { a: b }',
    '',
  ].join('\n')));
  assert.deepEqual(cfg.roles, { task_reviewer: ['codex'] });
  assert.deepEqual(cfg.warnings, [
    { key: 'config.invalid_section', params: { section: 'roles.task_reviewer' } },
    { key: 'config.invalid_section', params: { section: 'roles.final_reviewer' } },
  ]);
});

test('roles: optional @effort override on harness or harness/model normalizes to alto|medio|baixo and warns when invalid', async () => {
  const { roleChain } = await import('../skills/baco-sdd/scripts/lib/config.mjs');
  const cfg = loadConfig(rootWith([
    'harnesses:',
    '  claude-code:',
    '    models: { forte: opus, medio: sonnet }',
    '  codex:',
    '    models: { forte: gpt-x }',
    'roles:',
    '  task_reviewer:',
    '    - codex',
    '    - claude-code/opus@baixo',
    '    - claude-code@low',
    '    - claude-code/sonnet@invalido',
    '    - claude-code/@medio',
    '  pr_reviewer:',
    '    - codex/gpt-x@high',
    '',
  ].join('\n')));
  assert.deepEqual(cfg.roles, {
    task_reviewer: ['codex', 'claude-code/opus@baixo', 'claude-code@baixo'],
    pr_reviewer: ['codex/gpt-x@alto'],
  });
  assert.deepEqual(roleChain(cfg, 'task_reviewer'), [
    { harness: 'codex', tool: 'codex', model: null },
    { harness: 'claude-code', tool: 'claude-code', model: 'opus', effort: 'baixo' },
    { harness: 'claude-code', tool: 'claude-code', model: null, effort: 'baixo' },
  ]);
  assert.deepEqual(roleChain(cfg, 'pr_reviewer'), [
    { harness: 'codex', tool: 'codex', model: 'gpt-x', effort: 'alto' },
  ]);
  assert.deepEqual(cfg.warnings, [
    { key: 'config.invalid_section', params: { section: 'roles.task_reviewer' } },
    { key: 'config.invalid_section', params: { section: 'roles.task_reviewer' } },
  ]);
});

// 1.10.0: risk criterion, delivery size, spec freeze, review focus, final rounds, test runs, CI
// minutes, delivery destination and specialist QA.
const invalid = (section) => ({ key: 'config.invalid_section', params: { section } });

test('1.10.0 defaults: planning, review, test_runs, ci, delivery and qa', () => {
  assert.deepEqual(DEFAULTS.planning, { task_split: 'funcionalidade', risk: {}, max_tasks: 8, max_criteria: 60, freeze_specs: true });
  assert.deepEqual(DEFAULTS.review.focus, { always: [], suggestion: [] });
  assert.equal(DEFAULTS.review.final_rounds_max, 2);
  assert.deepEqual(DEFAULTS.test_runs, { screen_task_full: false, ci_full: 'merge' });
  assert.deepEqual(DEFAULTS.ci, { monthly_minutes: null });
  assert.deepEqual(DEFAULTS.delivery, { target: 'integration', integration_merge: 'ask' });
  assert.deepEqual(DEFAULTS.qa, { specialist: [] });
  const cfg = loadConfig(rootWith());
  for (const k of ['planning', 'test_runs', 'ci', 'delivery', 'qa']) assert.deepEqual(cfg[k], DEFAULTS[k], k);
  assert.deepEqual(cfg.review.focus, DEFAULTS.review.focus);
  assert.deepEqual(cfg.warnings, []);
});

test('1.10.0 keys: valid values load as written', () => {
  const cfg = loadConfig(rootWith([
    'planning:',
    '  risk:',
    '    arriscada: "login, permissão, separação entre clientes"',
    '    mecânica: "texto de tela, estilo"',
    '  max_tasks: 5',
    '  max_criteria: 40',
    '  freeze_specs: off',
    'review:',
    '  focus:',
    '    always: ["login", "dado de outro cliente"]',
    '    suggestion:',
    '      - virada da meia-noite',
    '  final_rounds_max: 3',
    'test_runs:',
    '  screen_task_full: on',
    '  ci_full: manual',
    'ci:',
    '  monthly_minutes: 2000',
    'delivery:',
    '  target: main',
    '  integration_merge: auto',
    'qa:',
    '  specialist: ["leitor de tela", contraste]',
    '',
  ].join('\n')));
  assert.deepEqual(cfg.warnings, []);
  assert.deepEqual(cfg.planning, {
    task_split: 'funcionalidade',
    risk: { arriscada: 'login, permissão, separação entre clientes', mecanica: 'texto de tela, estilo' },
    max_tasks: 5, max_criteria: 40, freeze_specs: false,
  });
  assert.deepEqual(cfg.review.focus, { always: ['login', 'dado de outro cliente'], suggestion: ['virada da meia-noite'] });
  assert.equal(cfg.review.final_rounds_max, 3);
  assert.equal(cfg.review.external_rounds_max, 3);
  assert.deepEqual(cfg.test_runs, { screen_task_full: true, ci_full: 'manual' });
  assert.deepEqual(cfg.ci, { monthly_minutes: 2000 });
  assert.deepEqual(cfg.delivery, { target: 'main', integration_merge: 'auto' });
  assert.deepEqual(cfg.qa, { specialist: ['leitor de tela', 'contraste'] });
  // A single text is a one-element list; a half-filled focus keeps the other list empty.
  const one = loadConfig(rootWith('review:\n  focus:\n    always: login\nqa:\n  specialist: leitor de tela\n'));
  assert.deepEqual(one.review.focus, { always: ['login'], suggestion: [] });
  assert.deepEqual(one.qa.specialist, ['leitor de tela']);
  assert.deepEqual(one.warnings, []);
});

test('1.10.0 keys: a bad value is dropped (the default stays) with config.invalid_section naming it', () => {
  const cases = [
    ['planning:\n  max_tasks: 0\n', 'planning.max_tasks', (c) => c.planning.max_tasks === 8],
    ['planning:\n  max_tasks: 2.5\n', 'planning.max_tasks', (c) => c.planning.max_tasks === 8],
    ['planning:\n  max_criteria: muitos\n', 'planning.max_criteria', (c) => c.planning.max_criteria === 60],
    ['planning:\n  freeze_specs: sim\n', 'planning.freeze_specs', (c) => c.planning.freeze_specs === true],
    ['planning:\n  risk: alto\n', 'planning.risk', (c) => JSON.stringify(c.planning.risk) === '{}'],
    ['planning:\n  risk:\n    padrao: "o resto"\n    arriscada: login\n', 'planning.risk.padrao', (c) => JSON.stringify(c.planning.risk) === '{"arriscada":"login"}'],
    ['planning:\n  risk:\n    arriscada: ""\n', 'planning.risk.arriscada', (c) => JSON.stringify(c.planning.risk) === '{}'],
    ['planning:\n  risk:\n    mecanica: [a, b]\n', 'planning.risk.mecanica', (c) => JSON.stringify(c.planning.risk) === '{}'],
    ['review:\n  focus: login\n', 'review.focus', (c) => c.review.focus.always.length === 0],
    ['review:\n  focus:\n    always: { a: b }\n', 'review.focus.always', (c) => c.review.focus.always.length === 0],
    ['review:\n  focus:\n    suggestion: [ok, ""]\n', 'review.focus.suggestion', (c) => JSON.stringify(c.review.focus.suggestion) === '["ok"]'],
    ['review:\n  focus:\n    outra: [x]\n', 'review.focus.outra', (c) => !('outra' in c.review.focus)],
    ['review:\n  final_rounds_max: 0\n', 'review.final_rounds_max', (c) => c.review.final_rounds_max === 2],
    ['test_runs:\n  screen_task_full: "true"\n', 'test_runs.screen_task_full', (c) => c.test_runs.screen_task_full === false],
    ['test_runs:\n  ci_full: sempre\n', 'test_runs.ci_full', (c) => c.test_runs.ci_full === 'merge'],
    ['test_runs: on\n', 'test_runs', (c) => c.test_runs.ci_full === 'merge'],
    ['ci:\n  monthly_minutes: -1\n', 'ci.monthly_minutes', (c) => c.ci.monthly_minutes === null],
    ['ci:\n  monthly_minutes: "2000"\n', 'ci.monthly_minutes', (c) => c.ci.monthly_minutes === null],
    ['ci: 2000\n', 'ci', (c) => c.ci.monthly_minutes === null],
    ['delivery:\n  target: develop\n', 'delivery.target', (c) => c.delivery.target === 'integration'],
    ['delivery:\n  integration_merge: sempre\n', 'delivery.integration_merge', (c) => c.delivery.integration_merge === 'ask'],
    ['delivery: [main]\n', 'delivery', (c) => c.delivery.target === 'integration'],
    ['qa:\n  specialist: { a: b }\n', 'qa.specialist', (c) => c.qa.specialist.length === 0],
    ['qa: leitor\n', 'qa', (c) => c.qa.specialist.length === 0],
  ];
  for (const [yaml, section, check] of cases) {
    const cfg = loadConfig(rootWith(yaml));
    assert.deepEqual(cfg.warnings, [invalid(section)], yaml);
    assert.ok(check(cfg), yaml);
  }
});

// product.uses_ai: the system being built calls an AI model (turns on the prompt-injection requirements).
test('product.uses_ai: default false, a boolean loads, a bad value is dropped with config.invalid_section', () => {
  assert.deepEqual(DEFAULTS.product, { uses_ai: false });
  const none = loadConfig(rootWith());
  assert.deepEqual(none.product, { uses_ai: false });
  assert.deepEqual(none.warnings, []);
  const on = loadConfig(rootWith('product:\n  uses_ai: on\n'));
  assert.equal(on.product.uses_ai, true);
  assert.deepEqual(on.warnings, []);
  const empty = loadConfig(rootWith('product:\n  uses_ai:\n'));
  assert.equal(empty.product.uses_ai, false);
  assert.deepEqual(empty.warnings, []);
  for (const [yaml, section] of [
    ['product:\n  uses_ai: sim\n', 'product.uses_ai'],
    ['product:\n  uses_ai: "true"\n', 'product.uses_ai'],
    ['product:\n  uses_ai: 1\n', 'product.uses_ai'],
    ['product: true\n', 'product'],
  ]) {
    const cfg = loadConfig(rootWith(yaml));
    assert.deepEqual(cfg.warnings, [invalid(section)], yaml);
    assert.equal(cfg.product.uses_ai, false, yaml);
  }
});

test('cleanup.commands: default empty list, scalar or list accepted, bad section warns', () => {
  assert.deepEqual(DEFAULTS.cleanup, { commands: [] });
  assert.deepEqual(loadConfig(rootWith()).cleanup, { commands: [] });
  const single = loadConfig(rootWith('cleanup:\n  commands: docker compose down -v\n'));
  assert.deepEqual(single.cleanup.commands, ['docker compose down -v']);
  const many = loadConfig(rootWith('cleanup:\n  commands:\n    - npm run db:clean\n    - docker image prune -f\n'));
  assert.deepEqual(many.cleanup.commands, ['npm run db:clean', 'docker image prune -f']);
  const bad = loadConfig(rootWith('cleanup: true\n'));
  assert.deepEqual(bad.cleanup, { commands: [] });
  assert.deepEqual(bad.warnings, [invalid('cleanup')]);
});
