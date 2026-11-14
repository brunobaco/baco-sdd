# Documentação

Esta pasta reúne a documentação oficial do produto `<nome do produto>`. É a fonte de verdade: o que está aqui vale mais do que conversa, memória ou código.

## Mapa da pasta

- `visao-do-produto.md`: direção do produto e regras que valem para tudo. Muda pouco.
- `planejamento-do-produto.md`: o que vem primeiro, o que vem depois e o que entra na primeira versão.
- `catalogo-de-specs.md`: lista de todas as specs, com a versão de cada uma e a situação de cada uma (escrita, implementada, validada).
- `governanca/`: regras de como a documentação é criada, revisada e aprovada, e as anotações futuras.
- `specs/`: uma spec por assunto. A spec é o contrato: diz o que o produto deve fazer.
- `qa/`: os cenários de teste de cada spec.
- `arquitetura/`: como o sistema é montado (`arquitetura/README.md`) e por que as escolhas foram feitas (uma decisão por arquivo em `arquitetura/adr/`).
- `entregas/`: uma pasta por entrega, com plano, tarefas, andamento, custo, revisão e aceite.
- `custo-projeto.md`: o uso de tokens medido nas conversas das etapas fora das entregas (início do projeto, specs, arquitetura, evolução de spec). Aparece quando a primeira etapa é medida.
- `fontes/`: transcrições de reuniões e entrevistas. Servem de fonte para as decisões; não são contrato.

## Ordem de leitura

1. Esta página.
2. A visão do produto, em qualquer trabalho de spec.
3. O planejamento, quando o trabalho mexer em prioridade, ordem de entrega ou primeira versão.
4. As regras em `governanca/README.md`, antes de criar ou alterar uma spec.

Uma proposta de mudança na visão precisa ser explícita. Nunca se altera a visão em silêncio.

## Convenção de nomes

Cada spec e o arquivo de cenários de QA dela usam o mesmo `<nome>`:

```text
docs/specs/spec-<nome>.md
docs/qa/cenarios-qa-spec-<nome>.md
```

O `<nome>` usa letras minúsculas, palavras separadas por hífen, sem espaços e sem acentos.

## Ramos (branches)

- Ramo de integração: `<nome do ramo de integração, por exemplo develop>`. É daqui que o trabalho parte e é aqui que ele volta.
- Trabalho só de documentação: ramo próprio no formato `docs/<nome-do-trabalho>`.
- Entregas de implementação: ramo no formato `baco/ENT-NNN`, onde `NNN` é o número da entrega. Tarefas de uma entrega podem ter ramo `baco/ENT-NNN-<ID-da-tarefa>`.
- Ramo principal: `<nome do ramo principal, por exemplo main>`. Representa versões estáveis.

## Autorização

Nenhum documento é considerado aprovado, e nenhum merge (junção das mudanças) é feito, sem autorização humana explícita. Um commit (registro de uma mudança), um arquivo salvo, um pedido de revisão ou um teste passando não equivale a aprovação.
