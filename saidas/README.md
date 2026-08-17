# Planilhas geradas dos exemplos

Saídas produzidas pela aplicação a partir dos PDFs de `exemplos/`.

| Arquivo | Origem | Linhas |
|---|---|---|
| `time-card-01.xlsx` | Folha de frequência SIPON | 153 |
| `time-card-02.xlsx` | Banco do Brasil — Ponto Eletrônico (escaneado) | 152 |
| `time-card-03.xlsx` | Cartão de Ponto tabular (escaneado) | 280 |
| `payroll-02.xlsx` | Declaração de Remuneração | 5 |
| `payroll-03.xlsx` | Demonstrativo de Pagamento Mensal | 5 |
| `payroll-04.xlsx` | Recibo de Pagamento, dois por página (escaneado) | 5 |

Dois exemplos não têm planilha porque a aplicação os **recusa** em vez de
transcrever errado:

- `time-card-04` — cartão mecânico manuscrito, escaneado
- `payroll-01` — ficha financeira multi-coluna

Nos dois, a leitura saía plausível e errada. O motivo de cada recusa está em
`SOLUCAO.md`.
