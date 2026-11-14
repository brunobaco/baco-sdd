# Spec | `<nome da capacidade>`

<!--
COMO USAR ESTE MODELO (apague este bloco ao criar a spec real)
- Este arquivo é um esqueleto para copiar para `docs/specs/spec-<nome>.md`. Troque tudo que está entre `<` e `>`.
- Omita seções sem conteúdo. Não crie seções vazias só para completar a estrutura. Una seções pequenas quando fizer sentido.
- Nunca invente versão, data, aprovador, fontes consultadas, decisões, cobertura ou testes executados. Se não souber, deixe o campo em branco ou escreva "não informado".
- Preserve a convenção de IDs do projeto. Se o projeto já usa IDs com sigla (por exemplo RF-EMP-001) ou sem sigla (por exemplo RF-001), continue nela. Os IDs deste modelo usam a sigla XYZ só como exemplo e não correspondem a requisitos aprovados.
- Nunca reutilize nem renumere um ID já publicado. A spec descreve só o estado atual: item que sai do contrato sai do documento, e o texto anterior fica no Git. O número de um ID novo vem da linha `Próximos números livres`, que avança na mesma edição.
- Recomendação não é aprovação. Separe sempre: decisão humana aprovada, interpretação a validar, convenção técnica proposta e pendência ainda aberta.
- Escreva o contrato (o que o produto faz), não a arquitetura (como será construído).
-->

## Porta de entrada

- **O quê:** `<uma frase sobre o que esta capacidade faz>`
- **Para quem:** `<quem usa ou é afetado>`
- **Por quê:** `<o problema que resolve; com número quando houver>`
- **Fica de fora:** `<os itens principais que esta spec não cobre>`
- **Como saber se deu certo:** `<métrica de negócio, com número quando houver; se ainda não há, escreva "a definir">`

<!--
Este bloco não cria requisito; quem manda é o contrato abaixo. Não use IDs aqui. Revise o bloco a cada nova versão da spec. Nunca invente número ou métrica.
-->

## 1. Controle documental e fontes

| Campo | Valor |
|---|---|
| Código da spec | `XYZ` |
| Arquivo | `docs/specs/spec-<nome>.md` |
| Título | `<nome da capacidade>` |
| Versão | `0.1` |
| Próximos números livres | `<por série, o maior número já usado em qualquer versão, mais um; por exemplo RF-XYZ-002, RN-XYZ-002, INV-XYZ-002, CA-XYZ-002, P-XYZ-002>` |
| Situação do documento | `Rascunho` |
| Responsável | `<nome de quem responde por esta spec>` |
| QA correspondente | `docs/qa/cenarios-qa-spec-<nome>.md` |

<!--
A situação do documento usa os estados do catálogo (Rascunho, Em descoberta, Em revisão, Aprovada, Substituída). A versão aqui precisa ser igual à da última linha do histórico. Não registre aprovação humana aqui sem a pessoa, a data e o que foi aprovado.
-->

**Fontes consultadas:** `<caminhos ou links realmente consultados; se nenhuma, escreva "nenhuma até agora">`

**Aprovação humana:** não presumida.

**Implementação e testes executados:** não inferidos desta spec. O estado real fica no catálogo de specs e nas evidências de QA.

## 2. Objetivo, problema, escopo e fronteiras

- **Problema e público afetado:** `<quem sente o problema e como ele aparece hoje>`
- **Resultado esperado:** `<o que passa a ser possível ou verdadeiro quando a capacidade existir>`
- **Dentro do escopo:** `<o que esta spec cobre>`
- **Fora do escopo:** `<o que esta spec não cobre, de forma explícita>`
- **Capacidades relacionadas e contrato de interação:** `<outras specs com que esta conversa, e o que cada lado entrega ao outro; omita se não houver>`

## 3. Atores e conceitos

- **Atores e responsabilidades:** `<quem participa e o que cada papel pode fazer>`
- **Termos e conceitos:** `<defina só o que muda o resultado ou evita ambiguidade>`

## 4. Contrato normativo

<!--
Uma linha por requisito, no formato de item em negrito. Separe três coisas: o que o produto faz (RF), a condição que decide (RN) e o que nunca pode deixar de ser verdade (INV). Inclua restrições não funcionais (RNF) só quando forem verificáveis.
-->

- **RF-XYZ-001 | `<resultado funcional>`:** `<ator>` pode `<operação>` sob `<condição>`, produzindo `<resultado observável>`.
- **RN-XYZ-001 | `<regra de produto>`:** `<condição de negócio confirmada>` determina `<permitir, negar ou calcular>` e `<consequência>`. **Estado da afirmação:** regra de produto aprovada, somente com fonte e decisão verificadas.
- **INV-XYZ-001 | `<invariante>`:** `<propriedade>` permanece verdadeira mesmo diante de repetição ou de uso simultâneo relevante.

**Interpretação a validar:** `<hipótese de significado ainda não aprovada; não tratar como norma>`

**Convenção técnica proposta:** `<forma de representação que pode ser delegada; não apresentar como decisão de produto>`

## 5. Estados e fluxos

- **Estados e transições permitidas:** `<quando relevantes>`
- **Fluxo principal:** `<condição, ação, resultado>`
- **Alternativas, falhas, repetição e uso simultâneo:** `<somente as que mudam o resultado>`

## 6. Dados, políticas e experiência

- **Dados e restrições funcionais:** `<se pertinentes>`
- **Autorização, privacidade e políticas canônicas:** `<referências verificadas, por caminho; não copie a política>`
- **Experiência, feedback, acessibilidade e integrações:** `<conforme a necessidade do contrato>`
- **Dependências funcionais:** `<capacidade consumida, condição de uso e o que acontece se ela falhar; somente se relevante>`

## 7. Critérios de aceite

<!--
Cada critério tem pré-condição (Dado), evento (Quando) e efeito observável (Então). Cubra o caminho positivo, os negativos e os limites que mudam o resultado. Não crie dezenas de critérios equivalentes só para parecer completo. Use datas, valores e massas específicos quando a precisão for necessária para verificar o comportamento. A célula do ID leva só o ID; o nome do critério vai na coluna Título.
-->

| ID | Título | Dado | Quando | Então |
|---|---|---|---|---|
| **CA-XYZ-001** | `<nome curto do critério>` | `<contexto e pré-condição>` | `<ação de quem usa>` | `<resultado observável, incluindo efeito ou recusa>` |

## 8. Decisões e pendências

| ID | Questão | Motivo | Operação afetada | Consequência | Responsável | Destino ou condição de retomada |
|---|---|---|---|---|---|---|
| P-XYZ-001 | `<decisão ainda aberta>` | `<por que importa>` | `<operação>` | `<o que fica bloqueado e o que pode seguir>` | `<se conhecido>` | `<marco, fonte ou condição de retomada>` |

<!--
Registre pendência só quando ela afetar um resultado verificável e não puder ser decidida por quem escreve a spec. Não crie uma lista paralela de produto: use o registro oficial do projeto. Não transforme recomendação em aprovação.
-->

## 9. Rastreabilidade semântica e prontidão

| Origem | Verificação | Cobertura | Motivo |
|---|---|---|---|
| RF-XYZ-001 | CA-XYZ-001 | `<coberto, parcialmente coberto, ausente ou não aplicável>` | `<ator, condição, operação e efeito realmente verificados>` |
| RN-XYZ-001 | `<CA ou cenário de QA, se houver>` | `<coberto, parcialmente coberto, ausente ou não aplicável>` | `<regra e sentido do resultado: permite ou nega>` |
| INV-XYZ-001 | `<CA ou cenário de QA, se houver>` | `<coberto, parcialmente coberto, ausente ou não aplicável>` | `<propriedade preservada, inclusive em falha ou uso simultâneo>` |

<!--
Estar escrito no mesmo lugar não significa estar coberto. Confirme o mesmo ator, a mesma operação, a condição de limite, o sentido do resultado (permitir ou negar) e o efeito esperado. "Não aplicável" exige motivo e não conta como cobertura comprovada.
-->

- **Parecer de prontidão por recorte:** `<apta, apta com dependências ou bloqueada; justifique o recorte e não esconda decisão de produto pendente>`
- **Prontidão, aprovação humana, implementação e testes executados** são estados diferentes. Um não implica o outro.

## 10. Aprovação e histórico

| Versão | Responsável | Data | Alteração |
|---|---|---|---|
| 0.1 | `<nome>` | `<AAAA-MM-DD>` | Criação da spec como rascunho. |

<!--
Uma linha curta por versão salva: quem, quando e o que mudou, por ID (por exemplo `RN-XYZ-004 modificada; CA-XYZ-007 removida`). Versões anteriores, itens retirados e aprovações passadas não são narrados em outro lugar do documento; o texto anterior fica no Git. A última linha deve repetir a versão do quadro de controle documental.
-->
