# Governança da documentação de produto

Este documento reúne as regras de como a documentação do produto é criada, revisada, aprovada e mantida. Os modelos de arquivo ajudam no preenchimento e não criam regras novas. A documentação deve continuar útil mesmo sem nenhuma ferramenta de apoio.

## 1. Onde ficam os contratos e qual vale mais

- A pasta `docs/` do projeto, no ramo de integração, é a fonte oficial. A documentação funcional não é copiada para outros lugares.
- O índice geral (`docs/README.md`), a visão, o planejamento e o catálogo de specs têm finalidades diferentes. Prioridade e ordem vêm do planejamento, sem trocar o comportamento aprovado.
- Para saber qual comportamento vale, olhe nesta ordem:
  1. decisões humanas aprovadas e registradas;
  2. specs aprovadas e vigentes;
  3. visão e regras que valem para todo o produto;
  4. convenções compartilhadas;
  5. pesquisas externas;
  6. código e testes, só para conhecer o estado atual.
- Se duas fontes discordarem, mostre as fontes, as consequências e as alternativas, e peça decisão humana quando for preciso. A ordem acima não autoriza apagar a divergência. Histórico não vale mais do que o contrato vigente. Memória e conversa não substituem a documentação oficial.
- Cada conteúdo mora num único documento, o responsável por ele, e os outros apontam para lá pelo caminho ou pelo ID, sem repetir o texto. Isso vale, por exemplo, para spec que repete política que vale para todo o produto, anotação que repete requisito já aprovado e decisão que repete regra de spec. Resumo que só aponta (a porta de entrada da spec, o resumo no catálogo) e cenário de QA que deriva de um critério não contam como cópia. Ao encontrar repetição, mantenha o texto no documento responsável e troque as cópias por referência; se as cópias divergirem, trate como conflito entre fontes (item anterior) antes de escolher qual fica.
- Mudança na visão avalia o efeito no planejamento, e mudança material no planejamento avalia o efeito na visão. Nenhuma das duas muda por tabela da outra.

## 2. Autorização e mudanças no Git

- O Git é a ferramenta que guarda o histórico dos arquivos. Sem autorização, o trabalho é só de análise e proposta: sem ramo (linha de trabalho separada), sem escrita, sem commit (registro de uma mudança), sem pull request (pedido para juntar mudanças) e sem merge (a junção em si).
- Trabalho documental autorizado parte do ramo de integração, usa ramo próprio `docs/<nome-do-trabalho>` e mexe só nos arquivos combinados.
- Este processo não altera código, configurações nem automações. Apagar, renomear ou mover documentos exige autorização expressa.
- Commit, arquivo salvo, pull request, revisão, teste e merge não equivalem a aprovação de produto. Merge e registro de aprovação exigem autorização humana específica.
- Antes de escrever, confira contrato, QA, documentos afetados e referências. Depois, informe o ramo, os arquivos, as mudanças, as decisões, as pendências e o que foi realmente conferido.

## 3. Como consultar antes de escrever

- Antes de criar ou alterar uma spec ou o QA dela, leia `docs/README.md`, a visão, este documento, as anotações futuras, a spec e o QA em questão (se existirem) e as decisões relacionadas.
- Leia o planejamento quando o trabalho mexer em prioridade, ordem, primeira versão ou dependências. Leia o catálogo para saber o estado de cada contrato.
- Na descoberta, não transforme sozinho uma dúvida importante em pendência. Primeiro mostre ao responsável o impacto, as alternativas e uma recomendação, e ofereça decidir agora ou adiar de propósito.
- Uma spec cobre uma capacidade ou assunto completo. Divida só quando houver ciclos de vida, contratos, riscos ou aprovações realmente independentes. Não divida por tela, endpoint (ponto de acesso técnico do sistema) ou história de usuário.

## 4. Como identificar arquivos e itens

- Spec: `docs/specs/spec-<nome>.md`. QA: `docs/qa/cenarios-qa-spec-<nome>.md`. O mesmo `<nome>`, em minúsculas e com hífens, sem espaços e sem acentos.
- **Preserve a convenção existente.** Padrão `RF-001` ou com código `RF-ABC-001` (`ABC` é o código da spec). Se o projeto já usa outra convenção, continue com ela. A numeração avança por tipo (`RF`, `RN`, `RNF`, `CA`, `CT`) e, no formato com código, por spec.
- IDs publicados nunca são renumerados nem reaproveitados. Item que sai de uso sai do documento, e o texto anterior fica no Git. Para não reaproveitar número, cada spec registra nos metadados a linha `Próximos números livres` (o maior número já usado em qualquer versão, mais um, por série), e o QA faz o mesmo para os cenários `CT`.
- Dependências citam o assunto ou o documento pelo identificador, sem copiar versão ou estado da outra spec.

## 5. O que toda spec precisa ter

Contexto e problema, objetivo, escopo e limites, atores, comportamentos e requisitos, regras, critérios de aceite que dá para conferir, decisões e pendências, fontes, rastreabilidade, QA correspondente, aprovação e histórico.

Avalie sempre, cada um separado dos outros: permissões e isolamento, dados e privacidade, medição de uso, auditoria de negócio e observabilidade técnica. Se um deles não se aplica, escreva `Não se aplica` e a razão específica. Não invente funcionalidade só para preencher uma seção.

## 6. QA e rastreabilidade

- Cada spec tem um QA, sem versão própria. O QA se refere à versão exata da spec e só tira contratos dela.
- Cada cenário informa o tipo (`positivo`, `negativo`, `alternativo`, `exceção`, `limite`), os itens da spec que cobre, a automação (`automatizado`, `manual` ou `pendente`) e, quando houver execução, a evidência.
- Conferir rastreabilidade é conferir o sentido: o cenário precisa testar quem faz, em que condição, o limite, a autorização, o resultado e os efeitos. Citar IDs não basta.
- Toda mudança na spec exige revisar o QA. A linha `Situação do QA`, nos metadados do QA, diz contra qual versão da spec ele foi conferido e o resultado, por exemplo `revisado para a versão 1.2 da spec, sem alterações`.
- Código de teste automatizado não fica em `docs/qa/`. O estado atual de implementação e de validação fica só no catálogo.

## 7. Estados, versões e quem decide

Os estados são distintos e independentes:

- **Candidata:** a spec existe como proposta e ainda não foi aprovada. Situação documental `Rascunho`, `Em descoberta` ou `Em revisão`.
- **Aprovada:** uma pessoa decidiu, de forma explícita e registrada, que a spec vale. Situação documental `Aprovada`.
- **Implementada:** o código faz o que a spec aprovada diz. Fica registrado no catálogo, na coluna de implementação, com versão, commit (o registro da mudança no Git) e entrega.
- **Validada:** os testes ou a conferência humana mostraram que o código cumpre a spec. Fica registrado no catálogo, na coluna de validação.

Quem decide:

- Uma spec só se torna `Aprovada` por decisão humana explícita, registrada com responsável, data, versão e escopo. Recomendação de agente, de revisor ou de ferramenta nunca é aprovação.
- O QA só fica `Aprovada` se a mesma versão da spec estiver aprovada. O QA não aprova produto nem entrega.
- Mudança de significado em spec aprovada exige nova aprovação humana. Correção só de texto não pode mudar comportamento.
- Antes de recomendar uma spec como pronta, cruze a candidata com o QA, as decisões confirmadas, as regras relacionadas e as anotações futuras. Mostre ao aprovador qualquer decisão esquecida que mude integridade, unicidade, autorização, segurança ou viabilidade.
- Versões têm dois números, como `0.1` e `1.0`. O rascunho começa em `0.1`; a primeira versão aprovada é `1.0`. A versão só avança quando spec e QA são salvos no Git. Confirme o responsável humano antes de preparar uma versão, sem presumir nomes nem datas.

## 8. Como registrar mudanças

- A spec muda no próprio arquivo e descreve só o estado atual. Cada versão ganha uma linha curta na tabela de versões, com responsável, data e o que mudou, por ID. Versões anteriores, itens retirados e aprovações passadas não são narrados no documento: o histórico fica no Git.
- Item que sai do contrato sai do documento, e o número dele não volta a ser usado.
- Ao substituir uma spec inteira, registre no catálogo qual spec a sucede, ajuste o QA e consulte os impactos. O catálogo guarda versões e estado atual.
- Pendências e decisões não somem em revisão, passagem de trabalho ou mudança de versão sem uma disposição explícita: resolvida, rejeitada ou adiada de propósito.

## 9. Pendências e anotações futuras

- Pendências dentro de uma spec usam `bloqueante`, `pré-implementação`, `risco aceito`, `dependência`, `investigação`, `follow-up` ou `descarte` (`follow-up` é algo para acompanhar depois), com impacto, responsável e condição para encerrar.
- `anotacoes-futuras.md` guarda itens ativos que pertencem a outro assunto. Não são decisões aprovadas e não são uma lista paralela de tarefas. Antes de adicionar, procure se já existe um item parecido. Antes de retirar, confira se o assunto foi incorporado, rejeitado ou substituído e onde isso ficou registrado.

## 10. Vigência

Estas regras só passam a valer depois de aprovação humana e publicação autorizada no ramo de integração. Specs, QAs, decisões, IDs e aprovações já existentes não mudam por causa de uma regra nova.
