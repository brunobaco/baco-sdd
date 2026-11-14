<!-- baco:head a74ba9474f0cf41a08c28a872ef23013d222a392 -->
# Handoff de revisão — ENT-001

## Como usar

Para quem enviou este arquivo — revisor, ignore esta seção.

1. Abra uma conversa nova em outra IA, sem ferramentas.
2. Cole este arquivo inteiro na conversa.
3. Copie a resposta do revisor e traga de volta com `baco import-verdict ENT-001 <arquivo>` (ou use `-` para colar pela entrada padrão).

## Prompt do revisor

Você é um revisor de código independente. Este pacote tem tudo o que você precisa: um trecho da especificação, as decisões de arquitetura, o resultado dos testes e o diff do código. Você não tem acesso ao projeto, a ferramentas nem a nenhum outro arquivo.

## Regras

1. Revise somente contra o trecho da especificação e o diff deste pacote.
2. Nunca suponha código que não aparece no diff. Se algo não está à vista, não opine sobre isso.
3. Compare o diff com cada requisito e critério de aceite da especificação. Aponte o que viola, o que falta e o que sobra.
4. Se o pacote for um "delta" (o título diz isso), ele mostra só as mudanças desde a última revisão. Não aponte como ausente o código anterior, que simplesmente não aparece no diff.
5. Responda em texto simples: sem negrito, sem bloco de código, sem tabela.
6. Responda SOMENTE no formato abaixo, sem texto antes, sem texto depois e sem explicações extras.

## Gravidade dos achados

- `crítico`: viola a especificação, perde dados ou abre uma falha de segurança.
- `importante`: é um bug ou falta um teste que deveria existir.
- `sugestão`: qualquer outra melhoria.

## Formato obrigatório da resposta

```
VEREDITO: aprovado | ajustes | bloqueio
## Achados
- [crítico] caminho/arquivo.ts:42 — descrição
- [importante] caminho/outro.ts:10 — descrição
- [sugestão] — descrição sem local
```

- Na linha `VEREDITO:` escreva apenas uma das três palavras: `aprovado` (nada a corrigir), `ajustes` (há o que corrigir) ou `bloqueio` (não pode seguir como está).
- Cada achado fica em uma única linha, começando por `- [gravidade]`.
- O local (`caminho/arquivo:linha`) vem antes do traço `—`. Se o achado não tem local, omita-o e escreva só `- [gravidade] — descrição`.
- Se não houver achados, escreva `VEREDITO: aprovado` e deixe a seção `## Achados` vazia.

## Especificação

### docs/specs/spec-tarefas.md@1.0

- **RF-TAR-001 | Cadastrar tarefa:** a pessoa usuária pode cadastrar uma tarefa com título, produzindo uma tarefa listada.
- **RF-TAR-002 | Listar tarefas:** a pessoa usuária pode listar as tarefas cadastradas, produzindo a lista em ordem de criação.
- CA-TAR-001 | duas parcelas numéricas | a soma é pedida | o resultado é 2
- CA-TAR-002 | uma tarefa com título válido | a pessoa a cadastra | a tarefa aparece na lista
- CA-TAR-003 | uma tarefa sem título | a pessoa tenta cadastrá-la | o sistema recusa e explica o motivo

## Decisões de arquitetura

Nenhuma decisão de arquitetura informada.

## Resultado dos testes

Nenhum resultado de teste fornecido.

## Diff

```diff
diff --git a/docs/entregas/ENT-001-tarefas/plano.md b/docs/entregas/ENT-001-tarefas/plano.md
index 18fa6da..23d2ce8 100644
--- a/docs/entregas/ENT-001-tarefas/plano.md
+++ b/docs/entregas/ENT-001-tarefas/plano.md
@@ -2,7 +2,7 @@
 
 **Specs:** docs/specs/spec-tarefas.md@1.0
 
-**Base:** __BASE_SHA__
+**Base:** 231b1ec
 
 **Entrega:** ENT-001 | `Tarefas`
 
diff --git a/src/tarefas.mjs b/src/tarefas.mjs
new file mode 100644
index 0000000..73412f8
--- /dev/null
+++ b/src/tarefas.mjs
@@ -0,0 +1,13 @@
+const tarefas = [];
+
+// Cadastra uma tarefa com título.
+export function cadastrar(titulo) {
+  const tarefa = { id: tarefas.length + 1, titulo };
+  tarefas.push(tarefa);
+  return tarefa;
+}
+
+// Lista as tarefas cadastradas.
+export function listar() {
+  return [...tarefas].reverse();
+}
diff --git a/test/tarefas.test.mjs b/test/tarefas.test.mjs
new file mode 100644
index 0000000..4bee44e
--- /dev/null
+++ b/test/tarefas.test.mjs
@@ -0,0 +1,8 @@
+import { test } from 'node:test';
+import assert from 'node:assert/strict';
+import { cadastrar, listar } from '../src/tarefas.mjs';
+
+test('[CA-TAR-002] a tarefa cadastrada aparece na lista', () => {
+  cadastrar('Pagar a conta');
+  assert.equal(listar().length, 1);
+});
```

Responda agora somente no formato obrigatório acima.
