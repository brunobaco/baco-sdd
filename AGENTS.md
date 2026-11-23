# BACO-SDD

Se existir `/srv/ratoeira/areas/trabalho/AGENTS.md`, leia também esse arquivo antes de qualquer trabalho (vale para Codex e Antigravity; o Claude Code já o carrega).

Skill portátil (Agent Skills) e plugin do Claude Code para desenvolvimento orientado por especificação, da ideia à entrega verificada (fases 0 a 9). Plugin `baco` (comandos `/baco:*`, agentes `baco:<papel>`); marketplace e repositório `baco-sdd`.

Este arquivo orienta quem desenvolve o BACO, em qualquer ferramenta; o `CLAUDE.md` da raiz é um link para ele. O plugin não o carrega nos projetos de quem o usa (o aviso da validação sobre o `CLAUDE.md` na raiz é esperado).

## Nada pessoal vai para o GitHub

Este repositório é público. Nada pessoal entra nele, em nenhuma forma: arquivo, mensagem de commit, nome de ramo, marca, texto de PR, issue ou release. Isso inclui:

1. E-mail. Os commits usam o e-mail privado do GitHub (`user.email` local deste repositório, `...@users.noreply.github.com`); nunca o e-mail pessoal.
2. Caminhos de máquina (`/home/...`, `/srv/...`, `/Users/...`, pastas temporárias) e endereços de servidor ou IP. A única exceção é a linha do começo deste arquivo, que aponta para as instruções da máquina de quem desenvolve.
3. Nomes de outros projetos, clientes, empresas ou pessoas (só o autor no manifesto do plugin e no `LICENSE`). Produtos com que o BACO se integra (Claude Code, Codex, Ratoeira e outros) só aparecem quando o texto trata da integração.
4. Passagens de sessão, conversas, pedidos da pessoa, planos com contexto pessoal, pesquisas, transcrições e resultados de rodadas de teste com dados reais. Mensagem de commit segue o padrão `tipo(escopo): resumo` e nunca copia o pedido.
5. Qualquer chave, token ou senha.

Aqui entram só o plugin, a skill, o motor, os testes, os casos de avaliação com dados fictícios e documentos genéricos (`docs/estado.md` e `docs/decisoes.md`, sem nomes nem contexto pessoal). Registros de trabalho ficam fora do repositório.

Antes de cada envio ao GitHub, conferir o que vai sair: `git log origin/main..HEAD --format='%an <%ae>%n%B'` (autor, e-mail e mensagem de cada commit) e `git diff origin/main..HEAD` (conteúdo). Commit com e-mail pessoal ou mensagem fora do padrão é corrigido antes do envio. Na dúvida, fica de fora.

O envio automático da Ratoeira fica desligado para este projeto. O envio ao GitHub é feito pelo agente no fim de cada conversa que mudou algo no projeto, depois da conferência acima, e ele diz à pessoa o que mandou. Antes de enviar, os commits ainda não enviados que estiverem fora do padrão (mensagem automática ou pedido copiado, e-mail pessoal) são juntados num commit com mensagem no padrão. Commit já enviado nunca é reescrito. Uma trava local (`.git/hooks/pre-push`, fora do repositório) recusa o envio de commit com e-mail que não seja o privado do GitHub ou com mensagem fora do padrão; se ela barrar, corrigir o commit, nunca desligar a trava.

## Onde fica cada coisa

- `skills/baco-sdd/SKILL.md`: roteador das fases e regras centrais. Referências por fase em `skills/baco-sdd/references/`, papéis em `references/roles/`, modelos de documento em `templates/pt-BR/`.
- `skills/baco-sdd/scripts/`: motor de verificação em Node, sem dependências (`baco.mjs`, comandos e bibliotecas). Contrato em `scripts/README.md`.
- `agents/`, `commands/`, `hooks/`, `.claude-plugin/`: a camada do Claude Code.
- `evals/`: casos do `claude plugin eval` (testam o próprio BACO, não os projetos). `evals/e2e/`: roteiro e semente do teste ponta a ponta.
- Estado do trabalho em `docs/estado.md`; decisões em `docs/decisoes.md`.

## Comandos

- Testes do motor: `npm test` (Node 22 ou mais novo).
- Evals: ver `evals/README.md`. No Linux, o executor exige `bubblewrap` e `socat` instalados.
- Pacote da skill: `node tools/package.mjs`.
- Depois de mudar o código do plugin: `claude plugin update baco@baco-sdd` e abrir conversa nova.

## Rodada de teste ponta a ponta

Ao fim de cada rodada (`evals/e2e/roteiro.md`), depois de levar os problemas e os números para o `docs/estado.md` e o CHANGELOG, a pasta do projeto de teste é apagada inteira, com o relatório e os arquivos dela, e a entrada da pasta sai da configuração do Codex (`~/.codex/config.toml`) quando existir. Nenhuma pasta de rodada fica na pasta de trabalho.

## Convenções

- Arquivos da skill em inglês; tudo o que o agente diz à pessoa em pt-BR simples, sem travessão.
- Teste primeiro em mudança do motor. Mensagens do motor em `scripts/lib/messages.mjs`, em pt-BR e en.
- Commits pequenos, mensagem em inglês no padrão `tipo(escopo): resumo`.
- Mudanças em branch própria saindo da `main`; versão nova com CHANGELOG, marca `vX.Y.Z` e release com o pacote da skill.
