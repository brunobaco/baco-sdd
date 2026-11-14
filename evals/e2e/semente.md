# Semente da rodada ponta a ponta

Use sempre este texto, para as rodadas serem comparáveis. Responda a entrevista com as respostas prontas abaixo; não invente outras.

## A ideia (5 linhas)

**Lista de tarefas da equipe** é um app web pequeno. Uma equipe de até 15 pessoas
anota o que precisa ser feito, diz quem cuida de cada tarefa e marca o que já foi
concluído. Hoje isso vive em planilha e em mensagens soltas. O app deve ser simples
de usar no primeiro dia, sem treinamento.

## Respostas prontas para a entrevista

- **Quem usa:** equipes pequenas de escritório (5 a 15 pessoas); um gerente e os demais membros.
- **Plataforma:** só web, no navegador do computador. Sem app de celular.
- **Fora do escopo:** login com senha própria (nesta versão cada pessoa só escolhe o nome), notificações, anexos, comentários, relatórios, integração com outros sistemas.
- **Orçamento:** baixo, uma pessoa desenvolvendo; hospedagem gratuita ou de custo mínimo.
- **Prazo:** sem data fixa; a primeira entrega deve caber em uma sessão de trabalho curta.
- **Dados sensíveis:** nenhum; só texto de tarefas e nomes.

## Capacidades (specs)

**`tarefas`** — 4 critérios de aceite:
1. Criar uma tarefa com título (obrigatório) e descrição (opcional).
2. Listar as tarefas, as mais recentes primeiro.
3. Concluir uma tarefa; ela aparece como concluída na lista.
4. Tentar criar tarefa sem título mostra um aviso e não cria nada.

**`responsaveis`**, 3 critérios de aceite:
1. Atribuir uma tarefa a uma pessoa da equipe.
2. Filtrar a lista por responsável.
3. Tarefa sem responsável aparece como "Sem responsável" e entra no filtro.

## Tecnologia esperada (decidida na fase 3, não imposta)

TypeScript, Vitest para testes de unidade e Playwright para os testes de tela. Se o arquiteto propuser outra coisa, anote; aceite se a justificativa for boa.

## Evolução planejada

`tarefas` 1.0 para 1.1, com um critério novo:
5. Tarefa com prazo vencido aparece destacada na lista.

(Isso exige um campo de prazo; o `spec-diff` deve mostrar o que foi adicionado e o que mudou.)
