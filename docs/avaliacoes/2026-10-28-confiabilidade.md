# Pedidos novos e continuidade, 28/10/2026

O problema reportado era precisar reformular cada pedido novo até encontrar uma
frase aceita. A análise do histórico fictício e a reprodução mostraram falhas
de interpretação e de continuidade, sem evidência de erro de inicialização do
modelo nos casos observados.

## Causas e correções

Pedidos sem correspondência nas regras diretas caíam na consulta de preferências,
mesmo quando pediam agenda ou tarefas. O novo caminho usa o Qwen local para
selecionar uma categoria permitida e o código consulta a ferramenta correspondente.
Agendamentos assistidos continuam preparando uma prévia, com títulos, dias e
intervalos conferidos contra o texto humano. O modelo não confirma nem executa
alterações. As consultas de contexto agora usam um contrato próprio, somente
para respostas com fontes ou pedidos de esclarecimento.

A última resposta também substituía parte do estado anterior. Uma consulta de
tarefas no meio de um pedido podia apagar a proposta ou os horários que já haviam
sido informados. O servidor agora mantém a operação identificada na conversa
durante consultas bem-sucedidas, sem repetir os controles sob cada resposta.
Cancelamento e substituição por nova proposta respeitam a operação correta.
Estado enviado pelo cliente é recusado. Uma continuação rejeitada pelo validador
não contamina o último rascunho aceito.

Um teste adicional encontrou a IA confundindo uma consulta de amanhã com uma
continuação do plano. A classificação foi ajustada para considerar o pedido
atual; a categoria de continuação só fica disponível se há um rascunho nessa
conversa. Não houve treinamento nem alteração dos pesos do `qwen3:4b`.

## Método e resultados

O script `scripts/agent-dialogue-eval.ts` chama o modelo real, com tarefas e
preferências fictícias em diretório temporário. Os registros individuais usam
o núcleo em memória; a preparação de planos é simulada. Aplicação, cancelamento
e desfazer de planos são verificados separadamente pela integração com SQLite
temporário e modelo simulado. Nenhum teste acessa o banco pessoal ou o vault.

| Conjunto | Antes | Depois |
| --- | --- | --- |
| 12 diálogos principais completos, 21 mensagens | 1/12 | 12/12 |
| Primeira mensagem dos 12 diálogos | 5/12 | 12/12 |
| Cinco diálogos adicionais, sete mensagens | — | 5/5 |
| Três pedidos novos separados do ajuste | — | 3/3 |
| Regressão de linguagem com modelo | — | 54/54 |
| Regressão de planejamento com modelo | — | 15/15 |

Os cinco diálogos adicionais tiveram falhas usadas para corrigir o sistema e
passaram a integrar o conjunto de desenvolvimento. Os três últimos pedidos não
foram usados para ajustar o prompt. A avaliação verifica categorias e também
fontes, datas, títulos e intervalos esperados, além de escrita somente quando
autorizada. No resultado final foram aprovadas as 31 mensagens dos três conjuntos.
Acerto na primeira mensagem humana pode envolver identificação de intenção,
extração e uma correção interna limitada; não significa uma única geração do LLM.

Relatórios locais completos, ignorados pelo Git, em `data/pilot/dialogues/`:

- Antes: `1793223483533-qwen.json`.
- Depois: `1793224531055-qwen.json`.
- Adicionais: `1793224543311-qwen-holdout.json`.
- Separados: `1793224546879-qwen-unseen.json`.

Também passaram 133 testes unitários, checagem de tipos, build, integração da
conversa, integração de planos semanais, integração da API do agente e regressão
da agenda existente. A integração da conversa inclui consulta intermediária,
reinício da API, confirmação da proposta correta, rascunho com horário parcial,
cancelamento, desfazer e recusa de continuação injetada pelo cliente.

A demonstração em execução foi atualizada reiniciando somente a API, preservando
o banco e o histórico existentes. Na interface, com o modelo real, o pedido
`Queria encaixar meditação na quinta das 06h às 07h` preparou corretamente
29/10/2026, das 06:00 às 07:00. Em seguida, `Me passa a lista do que falta fazer`
consultou as duas tarefas fictícias e `não` cancelou aquela proposta. Nenhum
compromisso foi inserido nesse teste. O diagnóstico registrou 2,09 segundos para
preparar a proposta e 366 milissegundos para identificar e consultar as tarefas;
são medições dessas respostas, não uma estimativa geral de desempenho.

## Reprodução e limites

Com o Ollama local preparado e `qwen3:4b` disponível:

```bash
npm run agent:eval:dialogues
npm run agent:eval:dialogues -- --holdout
npm run agent:eval:dialogues -- --unseen
npm run agent:eval:language -- --with-model
npm run agent:eval:planning
npm run test:agent
npm run test:agent:chat
npm run test:agent:weekly
npm run test:agent:api
npm run test:agenda
npm run typecheck
npm run build
```

São amostras pequenas, incluindo exemplos usados no desenvolvimento. Esses
resultados não demonstram compreensão de qualquer frase nem substituem o antigo
resultado de 7/16 do contrato original do modelo. O escopo continua sendo agenda,
consulta de tarefas e preferências e sugestão simples de estudo, com as restrições
documentadas na conversa. Finanças e planos gerais de vida ainda não têm ferramentas.

Cada nova falha deve virar um diálogo reproduzível com resultado esperado
(ferramenta, dados, esclarecimento ou recusa), ser classificada por causa e entrar
na regressão. A verificação também precisa incluir pedidos separados dos usados
no ajuste. Acrescentar uma frase aceita sem medir esse conjunto não comprova
melhora de compreensão.
