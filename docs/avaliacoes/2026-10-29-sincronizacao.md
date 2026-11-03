# Conversa e calendário: sincronização, 29/10/2026

## Resultado observado na interface

O ciclo completo foi executado em `http://127.0.0.1:8790`, a partir da cópia
principal em `/Users/cesararanha/dev/agenda`. A demonstração foi iniciada com
SQLite temporário, contexto fictício e integrações pessoais desativadas.
O modelo utilizado na interpretação foi o Qwen local, pelo Ollama.

1. `Queria encaixar meditação na sexta das 18h às 19h.` preparou uma proposta
   para 30/10/2026, das 18:00 às 19:00, sem inserir o compromisso.
2. `Pode confirmar` aplicou o plano e o compromisso apareceu no calendário.
3. No diálogo do calendário, os controles nativos de início e fim alteraram o
   intervalo para 19:00 às 20:00. A edição manteve o mesmo ID do compromisso.
4. De volta à conversa, `Quais são meus compromissos de sexta?` retornou
   `19:00 às 20:00: Meditação`, com a agenda como fonte.
5. A consulta à API confirmou um único compromisso com esse título e o mesmo
   ID, no horário atualizado. Recarregar a página preservou a conversa.

A preparação da proposta mediu 3,46 segundos e chamou o modelo. A consulta final
mediu 5 milissegundos e foi resolvida pelo código usando a agenda atual. Esses
valores descrevem somente as respostas observadas, não uma garantia de desempenho.

## Divergências investigadas

O preenchimento automatizado de `input type=time` mudou os valores exibidos sem
atualizar o estado controlado do formulário. A primeira gravação manteve os
horários antigos. Repetir o teste com os controles nativos e teclado atualizou
tanto o calendário quanto a API. Não foi atribuída ao produto uma falha que só
se reproduziu com esse mecanismo de preenchimento automatizado.

Ao adicionar a regressão de integração, surgiu uma falha independente no
interpretador direto: o título `Meditação` virava `Meditacao`, porque o texto
normalizado para reconhecer a instrução também era usado como título de saída.
Um teste unitário novo reproduziu a perda de acentos antes da correção.

A correção reaproveita `groundedTitle` para recuperar a grafia presente na
mensagem humana, mantendo as validações existentes. O teste também cobre títulos
diferentes e a herança de um título acentuado por outros dias. Datas, horários,
autorização e transações mantêm seus caminhos anteriores.

## Proteção automática

`scripts/agent-chat-regression.mjs` passou a cobrir:

- preparar e confirmar um plano pela conversa;
- consultar a ocorrência pela API usada pelo calendário;
- editar o intervalo por `PATCH`, preservando o ID;
- consultar novamente pela conversa e exigir o horário novo;
- conferir ausência de duplicação e de escrita durante consultas;
- reiniciar a API e conferir evento, histórico e uma nova consulta.

Essa regressão usa SQLite real e um servidor de modelo simulado. Ela protege a
integração do software; o teste manual descrito acima também usou o modelo real
e o diálogo de edição da interface. Não equivale a uma avaliação geral de
compreensão de linguagem natural.

Validações: 134 testes unitários aprovados, checagem de tipos e integração da
conversa com a nova regressão aprovadas. A regressão semanal também foi executada
após a correção. Nenhuma agenda pessoal ou nota do vault recebeu alteração.

```bash
npm run typecheck
npm run test:agent
npm run test:agent:chat
npm run test:agent:weekly
```

As capturas da execução ficam localmente em `data/pilot/screenshots/`, ignoradas
pelo Git: `2026-10-29-sincronizacao-calendario.png` e
`2026-10-29-sincronizacao-conversa.png`.
