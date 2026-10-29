# Planejamento assistido, 28/10/2026

O próximo passo acrescenta interpretação de múltiplos compromissos pelo Qwen
local e retomada de pedidos incompletos. Usa o banco temporário da demonstração;
o vault pessoal e o banco pessoal não entram nos testes nem recebem escrita.
Não houve treinamento ou alteração de pesos.

## Método

O modelo retorna blocos de título, dias e intervalo, com campos ausentes explícitos.
O código confere os títulos contra o texto humano, resolve datas, confere os
intervalos contra os fornecidos, verifica cobertura dos dias e horários
reconhecíveis e restringe o conjunto a uma semana. Uma proposta nunca é confirmada
pelo modelo. A API prepara, aplica, cancela e desfaz usando as ferramentas
existentes. As validações de conflito e versão permanecem no código e no SQLite.

Uma extração inválida pode receber uma única correção com o motivo da recusa.
Não há laço sem limite. Negação, condição, remoções e recorrências não reconhecidas
pelo fluxo anterior são interrompidas antes desse novo interpretador. Uma resposta
que declara instruções não suportadas também recebe esclarecimento.

## Resultados observados

- 12/12 cenários de planejamento com Qwen real, incluindo pedidos incompletos,
  complementação, títulos diferentes, condições, datas e intervalos inválidos,
  instrução extra e compromissos em semanas diferentes.
- 3/3 pedidos adicionais separados dos exemplos do prompt: dois títulos novos,
  um título distribuído em vários dias e complementação de horário.
- 47/47 cenários anteriores de linguagem com os caminhos atuais habilitados.
- 119 testes unitários do avaliador, núcleo e recorrência aprovados.
- Integrações com SQLite temporário: rascunho após consulta de tarefas e reinício,
  aplicação confirmada de dois eventos, repetição sem duplicar, desfazer, correção
  de conflito preservando outro bloco e cancelamento. Os testes existentes
  continuam cobrindo rollback, concorrência, recorrência e a agenda normal.

Na execução principal final, houve 11 gerações para os 12 cenários. As durações
retornadas pelo Ollama ficaram entre 1,097 e 1,869 segundos por geração. O caso
`missing-time` precisou de duas tentativas: na primeira, o modelo traduziu o título
para inglês e a validação recusou; após receber o motivo específico, copiou o
título humano e identificou o horário ausente. As métricas de ambas as tentativas
são somadas no diagnóstico da resposta, quando disponíveis.

A avaliação inicialmente marcou 12/12 apenas por receber uma pergunta nos casos
incompletos. Ao exigir também uma pergunta sobre o compromisso correto, apareceu
11/12. A correção limitada com motivo específico resolveu o caso nessa execução.
Isso registra a diferença entre recusar uma saída e compreender corretamente o
que faltava, sem atribuir ao modelo uma qualidade maior do que a medida.

## Reprodução e limites

```bash
npm run agent:eval:planning
npm run agent:eval:planning -- --holdout
npm run agent:eval:language -- --with-model
npm run test:agent
npm run test:agent:chat
npm run test:agent:weekly
npm run test:agent:api
npm run test:agenda
npm run typecheck
npm run build
```

Os relatórios brutos com entradas, saídas, tentativas e métricas ficam em
`data/pilot/planning/`, ignorado pelo Git. O avaliador de planejamento usa Qwen
real, armazenamento em memória e uma ferramenta de prévia simulada, sem aplicar
planos. As integrações separadas usam SQLite real temporário e modelo fictício
para testar execução e respostas adversas de maneira reproduzível.

O corpus principal orientou os ajustes. Os pedidos adicionais não são exemplos
do prompt, mas continuam sendo uma amostra pequena. Esses resultados não provam
compreensão geral de linguagem natural nem substituem a avaliação anterior de
7/16 sob outro contrato. A validação de campos não prova toda a semântica de um
pedido: por isso a prévia integral e a confirmação humana continuam necessárias.

O planejamento assistido limita-se a inclusões com horários fornecidos em uma
semana. A escolha automática de horários para vários estudos, a edição geral de
séries, planos de finanças e viagens e a memória pessoal duradoura ainda não estão
implementados por esse caminho.

## Atualização: rotina com dias abreviados

O pedido reportado `Organize o meu trabalho. Deixe o horário fixo para todas as
semanas. Seg e qua 8 as 14. ter, qui, sex 8 as 16:30` passou a produzir cinco
séries Trabalho, todas começando às 08:00. Segunda e quarta terminam às 14:00;
terça, quinta e sexta às 16:30. O título declarado no início é mantido nos blocos,
abreviações com ou sem ponto são resolvidas e intervalos dispensam `das` ou `de`.

O caminho assistido também aceita repetição semanal declarada pelo humano,
incluindo complementação de horário em outra mensagem. A frequência fica fora
do contrato de saída do modelo e é derivada pelo código. Frequências diferentes,
exceções e limites não reconhecidos continuam exigindo esclarecimento.

Resultados desta atualização: 15/15 cenários de planejamento com Qwen real,
3/3 pedidos separados e 54/54 cenários de linguagem. Os 124 testes unitários,
checagem de tipos, compilação e integrações da agenda passaram. No SQLite
temporário, a frase reportada gerou cinco séries-base; suas ocorrências e horários
foram conferidos em semanas futuras até 2028, com confirmação após reiniciar,
repetição sem duplicar e desfazer. Duas séries interpretadas pelo caminho assistido
também foram confirmadas, consultadas numa semana futura e desfeitas.

Os relatórios brutos desta execução estão em `data/pilot/planning/1793221968700-qwen.json`,
`data/pilot/planning/1793222079432-qwen-holdout.json` e
`data/pilot/language/1793222082258-qwen.json`. Na interface da demonstração foi
conferida a prévia da frase exata e depois cancelada, sem registrar a rotina.
