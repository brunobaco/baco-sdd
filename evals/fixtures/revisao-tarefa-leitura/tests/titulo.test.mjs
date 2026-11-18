import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cadastrar } from '../src/tarefas.mjs';

test('[CT-TAR-003] recusa tarefa sem título e explica o motivo', () => {
  assert.throws(() => cadastrar('   '), /precisa de um título/);
});
