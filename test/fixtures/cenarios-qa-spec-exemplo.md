# Cenários de QA | Empresas (EMP)

## 1. Metadados, fontes e controle

| Campo | Valor |
|---|---|
| Código | `EMP` |
| Versão da spec | `1.2`, sem versão independente de QA |

## 4. Cenários de verificação

### CT-EMP-001 | Criar Empresa íntegra
- **Tipo:** positivo; **Estratégia:** integração.
- **Contratos:** RF-EMP-001, CA-EMP-001.
- **Automação:** automatizado (`tests/e2e/empresa.spec.ts`)
- **Então:** uma única Empresa é constituída.

### CT-EMP-002 | Limite de uma Empresa por identidade
- **Tipo:** limite; **Estratégia:** integração.
- **Contratos:** RF-EMP-001, CA-EMP-001.
- **AUTOMAÇÃO:** manual

### CT-EMP-003 | Repetição da mesma confirmação
- **Tipo:** negativo; **Estratégia:** integração.
- **Contratos:** RF-EMP-001, CA-EMP-002/003.
- **Automacao:** pendente

### CT-EMP-004 | Concorrência entre intenções diferentes
- **Tipo:** negativo; **Estratégia:** integração.
- **Contratos:** RF-EMP-001, CA-EMP-001.

## 8. Evidências de execução

| CT | Resultado | Data | Onde | Entrega |
|---|---|---|---|---|
| CT-EMP-003 | aprovado | 2026-10-28 | homologação | ENT-001 |
