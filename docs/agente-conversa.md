# Conversa de demonstração do Agente César 2.0

O app agora reúne painel do dia e conversa em uma demonstração com dados
inteiramente fictícios. A mesma API e interface da agenda são reaproveitadas;
o modo normal continua com o comportamento anterior.

## Abrir e experimentar

```bash
npm run agent:app
```

O comando compila a interface, prepara um banco SQLite e arquivos fictícios em
um diretório temporário e inicia a demonstração em `http://127.0.0.1:8790`.
Se a porta estiver ocupada, escolha outra:

```bash
AGENT_DEMO_PORT=8791 npm run agent:app
```

O Ollama é iniciado em loopback com cloud desativada se ainda não estiver rodando.
É preciso ter o modelo local já baixado, conforme o [preparo do piloto](agente-piloto.md).
Se o modelo não estiver disponível, consultas à agenda e tarefas e os registros
validados continuam funcionando; perguntas de memória informam a indisponibilidade.
Pedidos que dependem da extração assistida mantêm dia e horários e pedem o título.

Exemplos para enviar na conversa:

1. `Como está meu dia?`: consulta os compromissos do banco fictício.
2. `Quais tarefas estão abertas?`: lê as tarefas abertas do arquivo fictício atual.
3. `Qual minha preferência de estudo?`: usa o modelo local com uma nota fictícia e fonte identificada.
4. `Salve Caminhada hoje das 16h às 17h`: valida e registra na agenda fictícia.
5. `Sugira um bloco de estudo para hoje`: procura um intervalo livre na janela e duração informadas na nota de exemplo.
6. Clique em **Confirmar sugestão**: o código confere novamente a proposta antes de registrar.
7. `Quero marcar um racha quita feira a noite. Quais os meus compromissos`: consulta a próxima quinta à noite, informa a correção de grafia e pede os horários que faltam.
8. Responda `das 20h às 21h`: prepara a proposta para o dia da conversa anterior. `Pode confirmar` registra essa proposta; `não` cancela a proposta pendente.
9. `Salve Leitura amanhã às 08h`: pede o fim. `Até 09h` completa o pedido explícito e registra, conferindo conflitos novamente.
10. `Como está minha semana`: consulta segunda a domingo no banco da agenda, sem inventar disponibilidade a partir das preferências.
11. `Vamos organizar minha semana. Primeiro remova todos os compromissos depois coloque segunda e quarta o trabalho das 8 às 14. Terça quinta e sexta das 10 às 16`: prepara uma prévia completa de substituição da semana, com cinco novos blocos. **Confirmar plano completo** aplica o conjunto e **Desfazer plano** restaura os compromissos anteriores.
12. Depois de preparar uma proposta, `melhor sexta das 20h às 21h` substitui a sugestão anterior e pede nova confirmação. `Na verdade amanhã` também altera o dia de um pedido incompleto, mantendo os horários já informados.
13. Após registrar um compromisso, `mude para domingo` prepara uma edição do mesmo evento, com confirmação. O reagendamento preserva título e duração; alterações desses campos continuam pelo calendário.
14. `Vamos organizar minha semana! Remova todos os compromissos da semana. Após isso marque os dias do meu trabalho fixos para todas as semanas. Segunda e quarta de 8 às 14. Terça, quinta e sexta. De 10 às 16:30.`: prepara remoções somente desta semana e cinco novas séries semanais, sem data final. A prévia diferencia essas duas abrangências; **Confirmar rotina semanal** aplica o conjunto.
15. `Você pode colocar o dentista na minha agenda amanhã das 9h às 10h?`: usa o Qwen para localizar o título no texto, confere dia e horários pelo código e prepara uma proposta. Só registra após confirmação. O diagnóstico identifica a interpretação assistida e suas medições.
16. `Na próxima semana coloque dentista segunda das 9h às 10h e leitura quarta.`: o Qwen separa os dois compromissos e o app pergunta pelos horários de leitura. Você pode consultar as tarefas nesse intervalo e depois responder `A leitura será das 18h às 19h.`. A prévia mantém o dentista e inclui a leitura. **Confirmar plano completo** registra ambos; **Desfazer plano** restaura o estado anterior.
17. `Pode remover todos os compromissos da semana?`: prepara uma prévia somente de remoções, sem exigir novas inclusões. **Confirmar remoções** aplica a retirada das ocorrências da semana mostrada; **Desfazer plano** restaura os compromissos. Uma semana já vazia recebe uma resposta sem gerar plano. `Pode…?` é entendido como pedido educado; negação e condição continuam pedindo esclarecimento.
18. `Organize o meu trabalho. Deixe o horário fixo para todas as semanas. Seg e qua 8 as 14. ter, qui, sex 8 as 16:30`: mantém o título Trabalho nos cinco blocos, expande as abreviações e prepara cinco séries semanais. A prévia mostra início às 08:00 em todos os dias, fim às 14:00 na segunda e quarta e às 16:30 nos demais. Confirme a rotina para gravar.

Registros aceitam também dia da semana, data brasileira, `16h-17h` e
`entre 8h e 9h`. Pedidos com negação, condição, datas inválidas ou intervalo
incompleto pedem esclarecimento. A ampliação não significa compreensão geral
de qualquer comando: as formas avaliadas estão no conjunto reproduzível abaixo.

Planos semanais mostram as datas e cada remoção e inclusão antes de aplicar.
`Minha semana` significa a semana atual, de segunda a domingo, inclusive dias que
já passaram. `Próxima semana` escolhe a seguinte. Os blocos valem somente para a
semana mostrada, a menos que o pedido diga explicitamente `todas as semanas`,
`semanalmente` ou `toda segunda`, por exemplo. Nesse caso são séries semanais
sem data final, e a frequência aparece na prévia. Uma parte não reconhecida
impede a preparação de todo o conjunto, em vez de ser ignorada.

Substituições aguardam confirmação, mesmo quando o pedido inicial usa o imperativo.
A aplicação tem uma única transação: se qualquer gravação falhar, as remoções,
inclusões e auditoria são revertidas juntas. Ocorrências recorrentes removidas
recebem exceções somente dentro da semana; a série continua fora dela. Eventos
que atravessam o limite da semana exigem esclarecimento. Uma edição posterior
invalida a prévia e bloqueia desfazer para não sobrescrever mudanças novas.
Para criar rotinas, os conflitos com outras recorrências são projetados por 365
dias a partir do início da semana, com a data final da verificação visível na
prévia. Eventos únicos já cadastrados são conferidos também além dessa janela.
Essa janela de verificação não limita a repetição: a série continua sem data
final. Novas alterações na agenda ainda precisam de conferência de conflitos.

Consultas aceitam dias da semana, datas, hoje/amanhã, semanas, períodos e horários.
O intervalo usado aparece na resposta (por exemplo, noite das 18h às 24h).
Depois de consultar quinta à noite, `E sexta?` mantém o período e consulta sexta.
Datas ambíguas ou inválidas recebem uma pergunta. Uma consulta de compromissos
usa a agenda, inclusive ocorrências recorrentes e eventos de dia inteiro.

Os botões de exemplo preenchem a mensagem para revisão. **Enviar** executa o pedido.
O painel atualiza após a resposta. **Ver calendário fictício** mostra os mesmos
eventos na interface de calendário existente. Recarregar preserva o histórico
concluído da conversa, os eventos e as propostas enquanto o banco temporário existir.

Cada resposta nova tem um diagnóstico expansível: indica se foi processada por
código ou se chamou o modelo, o caminho e as etapas realizadas e o tempo medido
na API. Consultas ao modelo mostram tokens de entrada e saída e tempos de
carregamento e geração fornecidos pelo Ollama. Ausência de métrica aparece como
“Não informado”; CPU, memória e energia não são estimadas. As fontes do contexto
aparecem por identificador, sem expor o texto das notas no diagnóstico.

O histórico preserva as medições da resposta original. Se uma resposta se perder
após uma escrita e precisar ser reconstruída pelo recibo da ferramenta, o
diagnóstico identifica a recuperação e mede essa reconstrução. Cada pedido tem
seu próprio rastro, inclusive em chamadas simultâneas.

O horário de referência da demonstração começa às 08:00 do dia em que ela é
iniciada. Isso mantém os exemplos reproduzíveis mesmo quando a demonstração é
aberta mais tarde. A preferência fictícia usada é de 35 minutos de estudo entre
14:00 e 18:00. Esses dados não representam preferências ou compromissos pessoais.

Use Ctrl+C no terminal do comando para encerrar. Somente os processos iniciados
pelo comando são encerrados, e somente seu diretório temporário é removido.
O modelo baixado permanece disponível. Não é instalado um serviço no login.

Para atualizar o código sem apagar o banco nem o histórico da demonstração,
compile a interface com `npm run build` e envie SIGHUP ao processo
`node scripts/agent-app-demo.mjs`. Ele reinicia somente a API. Para uma troca
completa de processo, `node scripts/agent-demo-snapshot.mjs` produz uma cópia
consistente dos dados fictícios e imprime seu diretório. Depois de encerrar a
instância anterior, use `AGENT_DEMO_RESTORE_DIR=<diretório> npm run agent:app`.
O snapshot fica no temporário do sistema e não contém o vault pessoal.

## Separação dos dados e decisões

O modo de demonstração exige banco em um diretório temporário `agenda-agent-sandbox-*`
e vaults e WhatsApp desativados. O launcher verifica a identificação da instância
antes de preparar compromissos, para não confundir outra API com a demonstração.
Não abre o banco pessoal e não lê notas pessoais para preparar os exemplos.

O SQLite guarda compromissos, propostas, recibos e histórico da conversa de teste.
Os arquivos fictícios guardam preferências e tarefas; são lidos pela camada de
contexto. As fontes consultadas ficam identificadas nas respostas.

Pedidos explícitos de registro e confirmação passam pelo núcleo e pela transação
SQLite. O modelo responde perguntas de contexto com fontes selecionadas. Para
alguns pedidos de registro não reconhecidos pela gramática direta, uma chamada
separada extrai somente o título, copiando um trecho contínuo da mensagem humana.
Dia e intervalo precisam estar completos e inequívocos no pedido e são resolvidos
pelo código. O resultado assistido sempre vira uma proposta pendente, sem escrita.
Título inventado, campos extras ou tentativa de ação são recusados. Se o modelo
falhar, a conversa mantém dia e horários e pede o título ao usuário. Nenhuma
dessas chamadas recebe executor de ferramentas ou acesso ao SQLite.

Saídas de consulta que tentam executar ações ou citar fontes inexistentes também
são recusadas. A sugestão de estudo é calculada pelo código a partir
da preferência fictícia, sem atribuir ao modelo uma capacidade de planejamento
que ainda não foi validada.

O histórico usa um identificador da conversa mantido por aba. Repetir a mesma
mensagem com o mesmo identificador recupera o resultado; reutilizar o identificador
com outro texto é recusado. Pedidos simultâneos idênticos compartilham a resposta.
Os recibos protegem também a gravação caso a resposta ou o registro do histórico
se perca depois do commit. Retentativas de rede exigem ação do usuário.

## Validação e limites atuais

```bash
npm run typecheck
npm run test:agent
npm run test:agent:chat
npm run test:agent:api
npm run test:agent:weekly
npm run test:agenda
npm run build
npm run agent:eval:language -- --with-model
npm run agent:eval:language -- --with-model --holdout
```

Foram aprovados 133 testes do avaliador, núcleo e recorrência, a integração da conversa com
modelo fictício, a integração com SQLite e a regressão da agenda normal.
Na interface com Ollama real, foram conferidos: consulta da preferência com fonte,
pedido incompleto, registro, conflito, sugestão pendente, confirmação, calendário
e restauração do histórico após recarregar. A pergunta reportada sobre o racha
foi repetida na interface e passou a consultar a quinta à noite corretamente.
A integração isolada também verifica confirmação natural após reiniciar a API,
repetição sem duplicar e cancelamento sem remover compromissos.

A demonstração ainda tem gramática restrita para escritas. O fluxo de planejamento
mantém o título e o dia para receber os horários em seguida, inclusive início e
fim em mensagens separadas. Pedidos diretos como `Salve Leitura amanhã às 08h`
preservam título, data e início para perguntar somente o que falta. Ao informar
o fim, o pedido explícito é validado e registrado, sem inventar duração. O rascunho
também sobrevive ao reinício da API; repetição recupera o recibo sem duplicar eventos.
Pedidos fora da gramática direta usam o identificador de intenção descrito abaixo.
Pedidos ainda ambíguos recebem esclarecimento. `Sim` só confirma uma proposta
específica identificada nesta conversa, inclusive depois de uma consulta intermediária.
Eventos de dia inteiro e recorrências podem ser consultados
e entram na conferência de conflitos de novos compromissos. O agente registra
eventos únicos com horário e séries semanais pelos planos confirmados; reorganizar
séries existentes e criar eventos de dia inteiro continua fora do escopo, conforme
os [limites do núcleo](agente-nucleo.md). Histórico concluído é persistido; uma
consulta ao modelo interrompida por recarga pode precisar ser reenviada.

A qualidade do modelo continua sendo avaliada separadamente dos controles do
código. A avaliação anterior de 7/16 não foi substituída por esses testes de
integração. Esta entrega não habilita ações do agente sobre dados pessoais.

Os testes de API verificam exceções movidas para antes e depois da série, exclusão
de uma ocorrência, séries antigas, dia inteiro recorrente, meia-noite, intervalos
adjacentes e rollback de confirmação sem consumir a proposta. O teste de conversa
confere estudo em um intervalo realmente livre e recusa de estudo em dia reservado.

Foram verificados também revisão de proposta, edição confirmada mantendo o ID,
conflito durante reagendamento, diagnóstico por pedido e isolamento das medições
entre consultas simultâneas. A interpretação geral pelo modelo continua uma
limitação conhecida; os testes do software não substituem a avaliação do LLM.

A avaliação de linguagem passou de 27/47 antes dos ajustes para 40/47 só com o
código e 47/47 com a extração restrita de títulos pelo Qwen. Outros três pedidos,
separados dos exemplos do prompt, passaram em 3/3. São amostras pequenas do fluxo
completo, não uma taxa geral de acerto do modelo. O método, as simulações usadas e
as limitações estão no [registro da avaliação](avaliacoes/2026-10-28-linguagem.md).

## Planejamento com o modelo local

O caminho assistido aceita inclusões com títulos, dias e horários diferentes na
mesma semana. O Qwen separa os blocos; o código resolve as datas e confere títulos,
intervalos, campos omitidos reconhecíveis e conflitos. A prévia usa a mesma
ferramenta transacional dos planos anteriores e sempre aguarda confirmação.
Uma saída fora do contrato ou com campos não rastreáveis ao humano pode receber
uma única tentativa de correção, acompanhada da falha de validação. Persistindo
o problema, o app pede esclarecimento; nenhuma parte é aplicada.

O rascunho guarda até seis mensagens, com até 4.000 caracteres no conjunto, somente
no banco fictício. A data de referência original fica preservada para não deslocar
`amanhã` caso a conversa atravesse a meia-noite. Uma consulta no meio da conversa
mantém o rascunho. O histórico persiste esse estado após reiniciar a API.
Pedidos em conflito mantêm o conjunto para receber uma correção. Cancelar limpa
o pedido pendente sem remover compromissos.

Esse novo caminho prepara inclusões de eventos com horários em uma semana,
também com repetição semanal declarada explicitamente pelo humano. A frequência
é determinada pelo código, não pela saída do modelo. Abreviações dos dias são
resolvidas em campos de agenda; não alteram notas ou preferências. Remoções
continuam no fluxo explícito anterior. Frequências diferentes, limites e misturas
de eventos únicos com semanais pedem esclarecimento. Não escolhe
automaticamente horários para vários blocos, não cria metas de vida, não altera
o vault nem habilita finanças. Cada área será acrescentada com ferramentas e
avaliações próprias.

O diagnóstico mostra o planejamento com IA local, as tentativas de geração e a
soma das métricas disponíveis. Esclarecimento esperado por dado ausente é
diferenciado de uma saída do modelo recusada. Veja o método e os limites na
[avaliação do planejamento](avaliacoes/2026-10-28-planejamento.md).

O conjunto de linguagem foi ampliado de 47 para 52 casos com a pergunta de remoção
reportada, variações educadas, próxima semana, negação e condição. Passou em 52/52.
A integração semanal confere remoção sem inclusões, confirmação após reiniciar,
semana vazia, cancelamento, repetição, rollback durante a remoção e desfazer exato,
preservando eventos e ocorrências fora da semana.

A avaliação de linguagem agora inclui a rotina abreviada reportada e uma variação
com pontos e intervalos com hífen, passando em 54/54. O planejamento com Qwen real
passou em 15/15 cenários, incluindo dois de recorrência semanal, um deles completado
em outra mensagem. Foram verificados em SQLite a criação das cinco séries do
pedido reportado, horários em semanas futuras até 2028, repetição sem duplicar e
desfazer, além de duas séries preparadas pela interpretação assistida do modelo.

## Pedidos novos e continuidade

Quando um pedido não entra nos caminhos diretos, o Qwen identifica se é uma
consulta de agenda, tarefas ou contexto, um agendamento, uma sugestão de estudo,
uma continuação ou uma ação fora do escopo. Ele retorna somente uma categoria
permitida. O código escolhe a ferramenta e valida seus argumentos; o modelo não
recebe executor nem pode confirmar uma proposta. A identificação considera a
mensagem atual: consultar horários não deve ser confundido com completar um plano.

Assim, `Me passa a lista do que falta fazer` consulta a fonte de tarefas, e
`Queria encaixar meditação na quinta das 06h às 07h` prepara uma proposta de agenda.
As consultas de preferências têm um contrato próprio de resposta com fontes,
sem os campos de execução usados no piloto inicial. Falta de informação recebe
uma pergunta e aparece como esclarecimento no diagnóstico.

Consultas intermediárias mantêm o compromisso, a proposta ou o rascunho aceito
na mesma conversa. Esse estado é salvo pelo servidor e sobrevive à recarga e ao
reinício da API. Uma resposta de consulta não repete os botões da proposta.
Cancelar encerra aquela operação; o app não escolhe outra proposta pendente
globalmente. O cliente não pode enviar um estado de continuação para a API.

O avaliador de diálogos confere fonte, data, título, intervalo, ausência de
escrita indevida e continuidade, usando o Qwen real e dados fictícios. Os
resultados e as limitações estão no [registro de confiabilidade](avaliacoes/2026-10-28-confiabilidade.md).

```bash
npm run agent:eval:dialogues
npm run agent:eval:dialogues -- --holdout
npm run agent:eval:dialogues -- --unseen
```
