# Evals do plugin BACO

Casos de teste que o `claude plugin eval` roda contra o plugin. Este arquivo registra o que o executor faz de verdade (verificado na versão 2.1.310, com haiku, 1 execução por caso).

## Como rodar

```
claude plugin eval . --eval-dir evals --scaffold --allow-tools "Edit,Write,Bash,Read(/$PWD/skills/**)" --ablation none --no-publish --trust-plugin --model sonnet --max-cost-usd 5
```

O `Read(/$PWD/skills/**)` (que vira `Read(//caminho/absoluto/skills/**)`, a forma absoluta das regras de permissão) é obrigatório: sem ele o executor nega o `Read` das referências da skill. Rode da raiz do plugin.

- `--eval-dir` só aceita nome simples (sem `/`, sem `_` no começo). Para rodar só um caso, use `--case <nome>`.
- Os casos ficam em `evals/<caso>/` com `case.yaml`, `prompt.md` e `graders/*.md`. O executor junta tudo num caso só.
- Resultados em `evals/results/<data>/` (fora do git).

## Capacidades verificadas

| Capacidade | Resultado | Observação |
|---|---|---|
| Scaffold que monta repositório git com branches | sim | `git init -b main`, commit e `git checkout -b baco/ENT-001` funcionam |
| Hook `branch-guard` dispara no eval | sim | Edit em `main` com `.baco/config.yaml` volta "Edição bloqueada: a branch main é protegida" |
| Nota de arquivo pré-existente modificado | sim | `target: {source: file, path: a.txt}` lê o arquivo depois da execução (edição na branch baco/ENT-001 passou a conter "oi") |
| Reaproveitar turnos anteriores (`history_file`) | sim | o arquivo é uma sessão `.jsonl` (usuário + assistente) passada a `--resume`; o modelo citou um código que só existia no histórico |

Nenhum "não": nenhum caso precisa de plano B manual.

## Regras do avaliador (lidas do código embutido do 2.1.310, sem rodar)

- `tool_used.input_match` é uma regex JS (`new RegExp(input_match).test(inputText)`) aplicada ao JSON inteiro da entrada da ferramenta (`file_path`, `old_string`, `new_string`, `command`...), não só ao caminho. Para falar de um arquivo, ancore no caminho: `file_path\"\\s*:\\s*\"[^\"]*/src/`.
- `tool_used.min` vale 1 por padrão. Um "não pode usar X" precisa de `min: 0`, `max: 0` e `arm: both`; só com `max: 0` o grader nunca passa.
- `regex` diferencia maiúsculas de minúsculas (campo `flags`, padrão vazio). Use `flags: i` quando a palavra pode abrir a frase.
- O corpo de um grader `llm` é a rubrica.

## Como o scaffold roda

- Roda com `bash`, só com `--scaffold`. `scaffold_script` aponta para um arquivo, relativo à pasta do caso.
- Diretório de trabalho: `<tmp>/home/cwd`. É o mesmo diretório onde o agente trabalha. `HOME` é `<tmp>/home`. A pasta `evals/` do repositório não está ali.
- `$0` é o caminho absoluto do script. Para chamar um auxiliar compartilhado em `evals/lib/`:

```
bash "$(dirname "$0")/../lib/make-repo.sh" <fixture> <branch>
```

  Testado: o auxiliar roda e herda o diretório de trabalho do scaffold. Não há variável de ambiente com o caminho do plugin.
- O diretório temporário é apagado ao fim; `--keep-temp` o preserva (e lacra `home/` e `tmp/`; abra com `chmod 700`).

## Diferenças em relação ao plano

- `target` do `regex` é `trace`, `last_message`, `files`, `mock_calls` ou o objeto `{source: file, path: <arquivo>}` (não existe `path:` solto).
- `tool_order` usa `before:` e `after:`. `file_exists` usa `path:` e `exists:` (padrão `true`).
- Com `history_file`, o caso precisa de prompt e o executor roda só o braço "com plugin" quando a ablação é automática.
- O agente continua com Bash/Grep se não forem barrados. Use `disallowed_tools` para impedir busca fora do caso.

## Uso observado (assinatura, não cobrança)

- Caso de hook: 3 turnos, ~58 mil tokens de entrada (quase todo de cache), ~1 mil de saída. "Estimativa do executor": cerca de 0,005 USD, só como medida relativa de consumo.
- Caso de edição: ~5 s. Caso de histórico: 5 turnos, ~10 s.
- `--max-cost-usd` é checado antes de iniciar cada execução. Com `0.001` e uma execução só, avisou "cost ceiling exceeded" e não parou nada. Só protege suítes com várias execuções.
- Cada execução começa com cerca de 19 mil tokens de prompt: prefira `runs` baixo e `max_turns` baixo.

## Ambiente do executor: Read do plugin e git (corrigido em parte)

Sonda com haiku (1 caso descartável, 4 execuções reais de 4 a 6 turnos; as duas primeiras tentativas falharam na validação e não gastaram nada):

- **Read do plugin: resolvido.** Em modo `dontAsk` o `Read` fora da área de trabalho é negado. `context.add_dirs` não serve: só aceita pastas dentro do caso (`..` é recusado). Também não serve a regra com caminho absoluto de uma barra só (`Read($PWD/skills/**)`): continua negado. Funciona `--allow-tools "Read(/$PWD/skills/**)"`, ou seja, `//` + caminho absoluto. O caminho que o modelo lê é o do próprio repositório, não uma cópia. Só abre `skills/` do plugin; a área de trabalho já é legível.
- **git na Bash do modelo: NÃO resolvido por configuração.** O `/usr/bin/git` do macOS é um atalho do `xcrun` e tenta gravar `xcrun_db-*` em `/var/folders/.../T`, que o sandbox nega (erro 72). O `env` do caso só aceita chaves `EVAL_*`; `DEVELOPER_DIR` e `PATH` no shell do operador não mudaram nada. O binário real `/Library/Developer/CommandLineTools/usr/bin/git` funciona. O scaffold não é afetado (roda fora do sandbox). Consequência: `git` e o motor (`baco ...` chama `git` do PATH) falham dentro da sessão. Saída possível: o motor procurar um git real quando o atalho falhar (decisão de projeto, não feita aqui).
- Uso da sonda (assinatura, não cobrança): 4 a 6 turnos por execução, cerca de 11 a 15 mil tokens de cache criado e 36 a 47 mil de cache lido por execução, 1,4 a 1,7 mil de saída. Estimativa do executor: 0,003 a 0,005 USD por execução (só medida relativa).
- Os graders `tool_used` contam a chamada mesmo quando ela é negada: um `Read` negado ainda passa `tool_used: Read`. Confira o trace (`permission_denials`).

### Tentativa de liberar o git por configuração no espaço de trabalho (não funciona)

O executor inicia a sessão com `--setting-sources user` e grava ele mesmo o `settings.json` do sandbox (`sandbox.enabled`, `allowUnsandboxedCommands: false`, escrita só em `HOME` e no tmp do caso) numa pasta de configuração que a sessão não lê nem escreve. Por isso um `.claude/settings.json` escrito pelo scaffold é ignorado. Sonda (1 execução, haiku, 4 turnos, ~10 mil tokens de cache criado, ~18 mil lidos, ~1,1 mil de saída; estimativa do executor 0,003 USD, só medida relativa): com `sandbox.excludedCommands: ["git","node"]` e `env: {PROBE_ENV: hello}` no arquivo, o `git` seguiu com exit 72 e `$PROBE_ENV` veio vazio. `TMPDIR` também não ajudaria: a sessão já tem `TMPDIR` dentro da pasta temporária do caso e o `xcrun` grava em `/var/folders/.../T` mesmo assim. Nada foi alterado no `make-repo.sh`.

## Limitações conhecidas e falhas esperadas no macOS

- **D-git: falhas esperadas no macOS.** O `git` da sessão não roda (ver acima), e o motor depende dele. Por isso, nesta máquina, estes graders falham por ambiente e não por defeito da skill: `ca-modificado/roda-guard-tests` (`guard-tests` precisa de commit e git), `plano-desatualizado/avisa-desatualizado` (`plan-freshness` sai 65 sem git, então a resposta não diz "desatualizado"). `plano-desatualizado/checa-o-plano` passa porque o grader só vê a tentativa. `meio-do-ciclo/llm-planeja-sem-bloquear` aceita que a resposta cite o git bloqueado, desde que ainda proponha o plano. Não conte essas falhas como regressão; elas passam num ambiente com git funcional.
- **Leitura de arquivos não é amarrada a uma ferramenta.** O modelo lê com `Read`, `cat` ou o motor (`catalog get`), e `tool_used` só aceita um nome de ferramenta. Por isso `retomada/le-progresso-e-t002` e `meio-do-ciclo/le-o-catalogo` são graders `llm` com `focus: trace` (aceitam qualquer meio). Não usamos `disallowed_tools` com regra de comando (`Bash(cat:*)`): o campo é documentado só para ferramentas inteiras e o modelo ainda leria com `head`, `sed`, `grep` ou `node -e`. Também evitamos `regex` sobre o trace, porque o texto das referências da skill (que entra no trace) já cita `progresso.md` e o catálogo.
- **Fixtures.** `CA-TAR-001` de soma só existe em `spec-soma` (usada por `ca-modificado` e `teste-falhando`); as demais specs de teste falam de tarefas. `meio-do-ciclo` usa `spec-aprovada-com-arquitetura` (arquitetura e ADR-001 aprovados, sem `.baco/config.yaml`), porque a skill exige arquitetura antes de planejar em projeto sem código.

## Cuidados ao escrever casos

- Use `max_turns` de pelo menos 6: com menos, a skill carrega, lê uma referência e a sessão acaba antes da resposta.
- Regex sobre `last_message` deve ser frouxa ou usar `flags: i`: o modelo conjuga e abre frases com maiúscula.

## Rodadas registradas

Data: 2026-10-29. Plugin 0.1.0. Modelo: sonnet. Uma execução por caso. Resultado mais recente de cada caso:

| Caso | Nota | Rodada | Observação |
|---|---|---|---|
| ativacao | 1.00 | 1 | passou |
| afrouxar-teste | 1.00 | 1 | passou |
| gate-obrigatorio | 1.00 | 7 | passou com o grader corrigido e o novo `catalogo-nao-aprovado` |
| ca-modificado | 0.75 | 8 | falhou `roda-guard-tests` (D-git, aceito: o modelo nem tentou o motor, usou `node --test`). `teste-espera-3` passou. `atualiza-o-teste` e `altera-o-codigo` eram `tool_used: Edit` e falharam porque o modelo editou com `sed -i` pela Bash, nunca com `Edit`; depois da rodada foram trocados por regras sobre o arquivo (`atualiza-o-teste` removido, pois `teste-espera-3` já cobre; `altera-o-codigo` agora exige que `src/soma.mjs` não tenha mais `return a + b;`). O 0.25 da rodada 7 foi com os graders antigos. Rodada 8 (2026-10-29, sonnet, 1 execução, graders novos, 12 turnos): 0.75; passaram `altera-o-codigo`, `retorna-o-valor-novo` (regex positivo: o código retorna `a + b + 1`, `1 + a + b` ou `3`; o `not_contains` sozinho passaria por mero reespaçamento ou arquivo vazio) e `teste-espera-3`; falhou só `roda-guard-tests` (D-git, aceito). Estimativa do executor, só como medida relativa: cerca de 0,17 USD; o resultado não separa tokens por tipo. O antigo `llm-valor-novo` (rodada 6) falhava porque o juiz `llm` não vê os arquivos e a rubrica pedia `guard-tests`, que no macOS não roda |
| retomada | 1.00 | 5 | passou |
| meio-do-ciclo | 1.00 | 5 | passou |
| plano-desatualizado | 0.75 | 5 | falha `avisa-desatualizado` (D-git: `plan-freshness` sai 65 sem git) |
| handoff | 1.00 | 5 | passou |

Falhas esperadas por D-git neste macOS: `ca-modificado/roda-guard-tests` e `plano-desatualizado/avisa-desatualizado`. Não são regressão; passam com git funcional.

Consumo somado das rodadas de 2026-10-29 (cinco rodadas, assinatura, não cobrança): 116 turnos; entrada nova 144, cache criado 285.192, cache lido 1.124.962, saída 24.142 tokens. Estimativa do executor, só como medida relativa: cerca de 1,69 USD. Os tokens da rodada 1 cobrem só 2 dos 4 casos (o rastro dos outros foi apagado).

Só a rodada 5 (5 casos): 37 turnos; entrada nova 50, cache criado 96.382, cache lido 462.049, saída 9.535 tokens; estimativa do executor cerca de 0,55 USD.

Rodada 7 (2026-10-29, sonnet, 1 execução por caso, só `ca-modificado` e `gate-obrigatorio`): 13 turnos (7 + 6); entrada nova 18, cache criado 43.446, cache lido 137.804, saída 1.544 tokens. Estimativa do executor, só como medida relativa: cerca de 0,22 USD.

### Como rodar

Um caso por vez:

Use o comando completo da seção "Como rodar" no topo deste arquivo, acrescentando `--case <caso> --keep-temp`.
