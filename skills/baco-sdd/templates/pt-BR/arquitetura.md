# Arquitetura | `<nome do projeto>`

<!--
COMO USAR ESTE MODELO (apague este bloco ao criar o documento real)
- Copie para `docs/arquitetura/README.md` e troque tudo que está entre `<` e `>`.
- Este documento só é aprovado por uma pessoa. Recomendação da IA não conta como aprovação.
- Escreva em linguagem de negócio sempre que der. Termo técnico entra com uma explicação curta ao lado.
- Cada escolha importante (banco, hospedagem, forma de login) vira uma decisão registrada em `docs/arquitetura/adr/` e entra na lista no fim.
- Não invente custo, versão nem nome de ferramenta que ninguém confirmou.
-->

## Visão geral

`<o que o sistema faz, quem usa e como as partes se conversam, em poucas frases>`

## Stack

| Camada | Escolha | Por quê |
|---|---|---|
| Interface (o que a pessoa vê) | `<ferramenta e versão>` | `<motivo em linguagem simples>` |
| Servidor (as regras de negócio) | `<ferramenta e versão>` | `<motivo>` |
| Dados (onde as informações ficam) | `<banco de dados>` | `<motivo>` |
| Hospedagem | `<onde o sistema roda>` | `<motivo>` |

## Fronteiras e organização interna

`<como o código se organiza por módulos de domínio dentro do repositório (monólito modular), direção de dependência (regras separadas de interface, HTTP, ORM e SDK externo), onde vivem contratos/tipos compartilhados entre front-end e back-end, e regras claras do que pode importar o quê (allow/disallow); evitar camadas de repasse sem valor>`

<!-- Opcional: inclua um diagrama Mermaid curto quando houver integrações externas, tarefas em segundo plano ou vários pontos de entrada. Quando já houver código, ancore cada bloco na pasta ou ponto de entrada real. -->

## Padrões transversais e operação

- **Contratos de API e segurança:** `<formato único de erro, paginação obrigatória em listagens, idempotência em ações críticas, checagem de dono do recurso (IDOR) e limite de requisições em rotas sensíveis>`
- **Saúde e logs:** `<como a saúde real das dependências é verificada e o que entra nos logs estruturados, sem credenciais nem dados pessoais>`
- **Recuperação (RTO e RPO):** `<tempo máximo aceito fora do ar, perda máxima de dados aceita, rotina de cópia de segurança e teste de restauração>`

## Modos de falha

| Dependência ou componente | Impacto para quem usa | Como o sistema responde (timeout, retry idempotente, degradação) |
|---|---|---|
| `<ex.: serviço de e-mail ou pagamento>` | `<o que para e o que segue funcionando>` | `<timeout explícito, fila/retry só onde é seguro repetir, aviso à pessoa>` |

## O que fica de fora agora e quando revisitar

| Peça adiada | Por que fica fora agora | Gatilho para revisitar |
|---|---|---|
| `<ex.: cache distribuído, microsserviços, fila dedicada>` | `<conta simples de carga ou tamanho do time>` | `<volume, latência, custo ou requisito que reabre esta escolha>` |

## Ferramentas de teste por plataforma

| Plataforma | Ferramenta | O que ela confere | Comando |
|---|---|---|---|
| Regras e funções | `<ex.: Vitest ou Jest>` | `<cada regra isolada>` | `<comando>` |
| Site no navegador | `<ex.: Playwright>` | `<fluxos completos como uma pessoa faria>` | `<comando>` |
| Aplicativo de celular | `<ex.: Maestro>` | `<fluxos completos no aparelho>` | `<comando>` |

Os comandos que geram relatório JUnit (o arquivo com o resultado dos testes) são os mesmos configurados em `.baco/config.yaml`.

## Ambientes

| Ambiente | Para que serve | Endereço | Quem pode mexer |
|---|---|---|---|
| Local | `<desenvolvimento do dia a dia>` | `<endereço ou "na máquina de quem desenvolve">` | `<quem>` |
| Homologação | `<testes antes de publicar>` | `<endereço>` | `<quem>` |
| Produção | `<uso real pelos clientes>` | `<endereço>` | `<quem; mudanças aqui exigem aprovação humana>` |

## Lista de ADRs

| ADR | Decisão | Status |
|---|---|---|
| `ADR-001` | `<decisão em uma frase>` | `<Proposta, Aceita ou Substituída>` |
