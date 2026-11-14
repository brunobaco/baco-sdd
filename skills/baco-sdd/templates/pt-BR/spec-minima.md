# Spec | `<nome da capacidade>`

<!--
COMO USAR ESTE MODELO (apague este bloco ao criar a spec real)
- Versão compacta, para capacidades pequenas. Copie para `docs/specs/spec-<nome>.md` e troque tudo que está entre `<` e `>`.
- Omita seções sem conteúdo. Não multiplique requisitos, critérios ou pendências só para preencher o esqueleto.
- Nunca invente versão, data, aprovador, fontes consultadas, decisões, cobertura ou testes executados.
- Preserve a convenção de IDs do projeto (com sigla, como RF-EMP-001, ou sem sigla, como RF-001). Os IDs deste modelo usam a sigla XYZ só como exemplo.
- Nunca reutilize nem renumere um ID já publicado. A spec descreve só o estado atual: item que sai do contrato sai do documento, e o texto anterior fica no Git. O número de um ID novo vem da linha `Próximos números livres`, que avança na mesma edição.
- Recomendação não é aprovação.
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

## Controle documental

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

**Fontes consultadas:** `<caminhos ou links realmente consultados; se nenhuma, escreva "nenhuma até agora">`

## Problema, objetivo e fronteiras

- **Problema, objetivo, atores e escopo:** `<descreva de forma curta>`
- **Fora do escopo e capacidades relacionadas:** `<somente se relevantes>`

## Contrato normativo

- **RF-XYZ-001 | `<resultado funcional>`:** `<ator>` pode `<operação>` sob `<condição>`, produzindo `<resultado observável>`.
- **RN-XYZ-001 | `<regra de produto>`:** `<regra, somente se aprovada; cite a fonte>`
- **INV-XYZ-001 | `<invariante>`:** `<propriedade que precisa se manter; somente se necessária>`

**Interpretação a validar:** `<se houver; não é norma>`

**Convenção técnica proposta:** `<se houver; pode ser delegada>`

## Critérios de aceite

| ID | Dado | Quando | Então |
|---|---|---|---|
| **CA-XYZ-001** | `<contexto>` | `<ação>` | `<resultado observável>` |

## Pendências

- **P-XYZ-001 | `<questão>`:** `<motivo, operação afetada, consequência, responsável se conhecido e condição de retomada; somente se houver pendência real>`

## Parecer e rastreabilidade

- `<recorte, fontes, o que de RF, RN e INV está realmente coberto por critérios ou cenários de QA, e as lacunas>`
- Prontidão, aprovação humana, implementação e testes executados são estados diferentes. Um não implica o outro.

## Aprovação e histórico

| Versão | Responsável | Data | Alteração |
|---|---|---|---|
| 0.1 | `<nome>` | `<AAAA-MM-DD>` | Criação da spec como rascunho. |
