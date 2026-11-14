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
test('context: defaults are handoff_at 400000 and auto_handoff false', () => {
  assert.deepEqual(DEFAULTS.context, { handoff_at: 400000, auto_handoff: false });
  const cfg = loadConfig(rootWith());
  assert.deepEqual(cfg.context, { handoff_at: 400000, auto_handoff: false });
});

test('context: a positive integer handoff_at and a boolean auto_handoff load', () => {
  const cfg = loadConfig(rootWith('context:\n  handoff_at: 250000\n  auto_handoff: on\n'));
  assert.deepEqual(cfg.context, { handoff_at: 250000, auto_handoff: true });
  assert.deepEqual(cfg.warnings, []);
  assert.equal(loadConfig(rootWith('context:\n  auto_handoff: false\n')).context.handoff_at, 400000);
});

test('context: invalid values warn in the existing style and keep the default for that key', () => {
  for (const bad of ['0', '-5', '1.5', 'muito', '"300000"', '[1]']) {
    const cfg = loadConfig(rootWith(`context:\n  handoff_at: ${bad}\n  auto_handoff: on\n`));
    assert.equal(cfg.context.handoff_at, 400000, bad);
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
  assert.match(text, /handoff_at: 400000/);
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
    'claude-code': { models: { forte: 'opus', medio: 'sonnet', leve: 'haiku' }, implementers: true },
    codex: { models: { forte: 'modelo-a', leve: 'modelo-c' }, implementers: false },
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
    opencode: { models: { leve: 'provedor/modelo' }, implementers: false },
    outro: { models: {}, implementers: false },
  });
  assert.deepEqual(cfg.warnings.map((w) => w.params.section), [
    'harnesses.codex', 'harnesses.opencode.models.forte', 'harnesses.opencode.models.turbo',
    'harnesses.opencode.implementers', 'harnesses.outro.models',
  ]);
});

// review.pr: who reviews the delivery's pull request, and whether findings are fixed on their own.
test('review.pr: defaults are agente and auto_fix true; valid values load', () => {
  assert.deepEqual(DEFAULTS.review, { external_rounds_max: 3, pr: { reviewer: 'agente', auto_fix: true } });
  assert.deepEqual(loadConfig(rootWith('review:\n  external_rounds_max: 2\n')).review, { external_rounds_max: 2, pr: { reviewer: 'agente', auto_fix: true } });
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

test('the pt-BR template documents harnesses and review.pr and loads without warnings', () => {
  const text = readFileSync(new URL('../skills/baco-sdd/templates/pt-BR/config.yaml', import.meta.url), 'utf8');
  assert.match(text, /^harnesses:/m);
  assert.match(text, /^ {2}pr:/m);
  assert.match(text, /reviewer: agente/);
  assert.match(text, /auto_fix: on/);
  const cfg = loadConfig(rootWith(text));
  assert.deepEqual(cfg.warnings, []);
  assert.deepEqual(cfg.review.pr, DEFAULTS.review.pr);
  assert.equal(cfg.harnesses['claude-code'].implementers, true);
});
