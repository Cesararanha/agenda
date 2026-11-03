# Mover e cancelar pela conversa, 29/10/2026

O incremento permite alterar compromissos já cadastrados pelo título e dia,
com escolha explícita quando há ambiguidade, revisão da prévia, confirmação e
desfazer. Funciona na demonstração isolada, junto do calendário existente.
Modelo e dados pessoais não foram modificados.

## Comportamento entregue

- `Mude a oficina de desenho de hoje para as 11h` procura o evento e prepara a
  mudança. Informar somente o início mantém a duração original, mostrada na prévia.
- `Mude para 12h` revisa o compromisso identificado e cancela a prévia anterior.
- `Cancele a oficina de desenho de hoje` apresenta uma prévia de cancelamento.
- Títulos repetidos mostram os horários e exigem uma escolha numerada.
- Faltando dia, título ou novo horário, a conversa mantém o pedido para receber
  o complemento. Consultar tarefas ou agenda nesse intervalo preserva o contexto.
- `Pode confirmar`, o botão correspondente ou `Pode cancelar` em uma prévia de
  cancelamento aplicam somente a alteração identificada. `Não` cancela a prévia.
- `Desfaça a alteração` restaura o compromisso e suas exceções, enquanto não houver
  outra escrita na agenda.

Em recorrências, a prévia informa que a ação afeta somente a ocorrência escolhida.
Os demais dias continuam na série. Um compromisso de dia inteiro pode ser
cancelado; sua conversão para horário definido continua no calendário.

## Interpretação e ferramentas

O modelo recebe mensagens humanas e devolve ação e trechos de título, dia e
horários, sem IDs, duração inventada ou executor. O código exige que esses
trechos estejam nas mensagens, resolve valores e confere cobertura temporal.
Pedidos condicionais, negação da ação e conjuntos não suportados recebem
esclarecimento em vez de aplicar uma parte do pedido.

Os candidatos são consultados na agenda atual. O código seleciona o registro,
confere conflitos e gera a prévia. Títulos repetidos exigem seleção, mesmo
quando o modelo poderia sugerir um deles. A seleção é revalidada antes de gravar.

`ChangeStore` guarda propostas, recibos e snapshots em tabelas exclusivas do
sandbox. Preparar não altera eventos. Confirmar verifica versão, registro e
conflitos novamente, e grava evento, auditoria, snapshot e recibo na mesma
transação. Repetir a confirmação não duplica o compromisso. O movimento mantém
o ID da série; uma ocorrência recorrente mantém sua identificação original.

Desfazer restaura todos os campos do registro e suas exceções anteriores. Uma
edição posterior bloqueia essa reversão. Falha da ferramenta faz rollback e
mantém a proposta para uma tentativa explícita. Estado de conversa enviado pelo
cliente é recusado; o modelo não confirma as próprias propostas.

## Resultados observados

| Verificação | Resultado |
| --- | --- |
| Testes unitários do projeto | 147/147 |
| Integrações de API, conversa, alterações, planos semanais e agenda | Cinco aprovadas |
| Tipos e build | Aprovados |
| Casos de linguagem anteriores com Qwen real | 54/54 |
| Planejamento com Qwen real | 15/15 e três adicionais |
| Diálogos anteriores com Qwen real | 12/12, cinco adicionais, três separados e seis de aceitação |
| Novos fluxos de alteração com Qwen, API e SQLite reais | 18/18 |

O avaliador novo prepara dados e contexto fictícios em um diretório temporário.
Cada caso exige ausência de escrita na preparação, confirmação correta,
resultado atual na agenda e restauração exata ao desfazer. Inclui mudança de
hora ou dia, revisão de prévia, título acentuado, identificação por horário,
escolha entre duplicados, dados ausentes, conflito, recorrência, dia inteiro,
pedidos compostos, negação e condição. Os controles de reinício, resposta perdida,
concorrência, recibos, versão e rollback usam também o servidor de modelo simulado.

A primeira rodada nova passou em 15/16. A regra de negação bloqueava a frase
`Não vou poder fazer a leitura amanhã. Pode cancelar esse compromisso?`, embora
o pedido de cancelamento fosse afirmativo. A correção passou a distinguir a
justificativa negativa da negação da ação na mesma oração, mantendo a confirmação
obrigatória. Foram acrescentados revisão de prévia e complemento do título,
chegando aos 18 casos finais. Esse conjunto participou do desenvolvimento e
não demonstra uma taxa geral de compreensão de linguagem natural.

Uma regressão de planejamento mostrou também 14/15 depois de adicionar a nova
categoria de intenção: um pedido de criação foi classificado como alteração.
Agora a categoria só é oferecida quando a mensagem pede explicitamente mover
ou cancelar. O planejamento voltou a 15/15 na rodada registrada.

Relatórios locais, ignorados pelo Git:

- Inicial novo: `data/pilot/changes/1793315391771-qwen.json` (15/16).
- Rodada anterior ampliada: `data/pilot/changes/1793315961234-qwen.json` (17/17).
- Final: `data/pilot/changes/1793319981464-qwen.json` (18/18).
- Linguagem: `data/pilot/language/1793315886561-qwen.json`.
- Planejamento: `data/pilot/planning/1793315912853-qwen.json` e
  `1793315920837-qwen-holdout.json`.
- Diálogos: `1793315925012-qwen.json`, `1793315931542-qwen-holdout.json`,
  `1793315933469-qwen-unseen.json` e `1793315940056-qwen-acceptance.json`
  em `data/pilot/dialogues/`.

O resultado antigo de 7/16 no contrato original do piloto continua registrado.
Não foi substituído por essas métricas de fluxos completos e não houve treinamento
nem ajuste dos pesos do Qwen.

## Conferência na interface

Em uma segunda demonstração descartável em 8791, a oficina de desenho de hoje
foi identificada pelo título, recebeu a prévia de 11:00–12:00 e foi revisada com
`Mude para 12h`. A prévia anterior foi cancelada. Confirmar moveu o mesmo registro
para 12:00–13:00 no calendário; desfazer o restaurou para 09:00–10:00.

O pedido explicado de cancelamento do clube de leitura gerou uma prévia. Após
`Pode cancelar`, só ele saiu do calendário. Desfazer o restaurou. Um segundo
evento chamado Oficina de desenho, às 17:00, foi criado exclusivamente para o
teste. A conversa pediu seleção entre 09:00 e 17:00. Depois de uma consulta de
tarefas, escolher a opção 2 cancelou somente o evento das 17:00 após confirmar.
O das 09:00 permaneceu, e desfazer restaurou o selecionado.

As capturas ficam em `data/pilot/screenshots/`, fora do Git. A demonstração do
usuário em 8790 foi preservada; a segunda instância foi usada apenas para os testes.

## Reprodução e limites

```bash
npm run test:agent:changes
npm run agent:eval:changes
npm run agent:eval:changes -- --case=complete-title
npm run agent:verify
npm run agent:verify:model
```

O primeiro comando usa modelo simulado e SQLite temporário. O segundo exige
Ollama e Qwen locais e testa todo o ciclo contra uma API isolada. Ambos removem
somente os diretórios de teste que criaram.

O fluxo trata um compromisso por vez. Séries inteiras e mudanças daqui para
frente continuam nos controles do calendário. O rascunho aceita até seis mensagens
e 4.000 caracteres; a seleção exibe até dez candidatos. Detalhes ambíguos ou fora
do contrato recebem esclarecimento. Desfazer depende da versão global da agenda.
O modo continua limitado aos dados fictícios, sem habilitar ações na agenda
pessoal, escrita no vault ou ferramentas financeiras.
