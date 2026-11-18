import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cadastrar } from '../src/tarefas.mjs';

test('[CT-TAR-002] cadastra uma tarefa com título', () => {
  assert.equal(cadastrar('Comprar pão').titulo, 'Comprar pão');
});
