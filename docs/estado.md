# Estado do trabalho

Atualizado em 2026-11-14.

## Pronto

1. Versão 1.0.0: tudo o que estava na seção não lançada do CHANGELOG desde a 0.1.2, com 614 testes do motor passando. Manifesto do plugin, marketplace, `SKILL.md` e CHANGELOG em 1.0.0.
2. Quatro rodadas de teste ponta a ponta com um app de exemplo (roteiro e semente em `evals/e2e/`). A divisão que funcionou melhor: Claude implementa e revisa as tarefas, Codex revisa o PR em modo só leitura.
3. README reescrito para a 1.0: proteções com o que garante cada uma (motor, plugin ou método) e tabela do que funciona com o plugin, só com a skill e nas outras ferramentas.
4. Licença MIT.

## Em andamento

Liberdade das ferramentas de IA quando constroem, em quatro etapas:

1. Feita na branch `feat/caixa-harness`: valor `sandbox` por ferramenta (`protegida`, `rede`, `livre`; padrão `rede`), regras de comando do BACO para o Codex e chamada do Codex por caixa. Testado nesta máquina com o modelo leve do Codex: rede, porta, instalação de pacote, regras no modo não interativo, também numa subpasta. Falta uma entrega inteira com o Codex construindo em `rede`.
2. Claude em `rede`, com o isolamento próprio do Claude Code. Conferir na documentação e testar aqui antes (pode atrapalhar MCPs, o envio ao GitHub e a chamada do Codex dentro da caixa do Claude).
3. Configuração completa e obrigatória no início do projeto, passando por todos os parâmetros e explicando cada opção.
4. Versão nova e configuração de um projeto real já em andamento como teste.

Gancho do BACO para o Codex na caixa `livre`: fica para depois. O Codex roda gancho antes de cada comando (`PreToolUse`, mesmo formato do Claude Code), mas gancho de projeto só roda aprovado pela pessoa ou com `--dangerously-bypass-hook-trust`, e o comando do gancho precisaria de um caminho que sirva em qualquer máquina.

## Pendente

1. Subir a imagem de prévia (`docs/imagens/previa-github.png`) nas configurações do repositório no GitHub (Settings, Social preview). É feito pelo site.
2. O logo novo, com expressão divertida (`logo-baco-sdd-engracado.png`), ainda não substituiu o ícone do plugin nem o do README.
3. Eval `afrouxar-teste` sem conclusão num Linux em que o isolamento do executor não monta a rede (provável `bwrap` sem liberação no AppArmor). Repetir.
4. Evals a escrever: conversa que passa do limite no meio da construção; retomada pela tabela "Tarefas em andamento"; plano com harness por tarefa; revisão do PR por agente com rodada de correção; harness único; revisor `pessoa` e `ambos`; saída 3; localizador; configuração antiga recebendo só as perguntas novas; projeto sem GitHub.
5. Não testado de ponta a ponta: OpenCode, regras de permissão com `*` no meio do comando.
6. Limites conhecidos: `provenance.ignore` não distingue pasta de código de pasta de registro pelo nome (a proteção é a aprovação humana); no modo `pr` o isolamento do revisor é só instrução; os logs em `.baco/logs/` se acumulam sem limpeza; `cost measure` não lê o OpenCode; faixas paralelas pouco usadas quando as tarefas dividem arquivos.

## Evoluções futuras

Sem data. Pequenas evoluções do método que ficaram para depois da 1.0; versão para o Codex sem perder o que o plugin dá (agentes próprios, bloqueio de edição em `main` e `develop`, reconhecimento automático do projeto, comandos); adaptar para OpenCode e Antigravity; metas numéricas de código na revisão; documentar sistema legado; resultado do CI como gatilho; comando do motor que lista as tarefas prontas para começar; conferência de `Próximos números livres` pelo histórico do Git.

## Próximo passo

Publicar a 1.0.0 (marca `v1.0.0` e release com o pacote da skill) e tornar o repositório público.
