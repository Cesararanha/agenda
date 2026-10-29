# Núcleo do Agente César 2.0, fase 2 em desenvolvimento

A primeira avaliação local registrou limites do modelo. A continuidade agora tem
um núcleo com controles de escrita, recuperação de contexto e consulta ao Ollama,
usando somente dados fictícios. O comportamento atual da agenda foi preservado.

Além da gramática descrita abaixo, a conversa agora tem interpretação assistida
de títulos e de múltiplos compromissos, com rascunho persistente e prévia
confirmada. O funcionamento e os limites atuais estão em
[Conversa de demonstração](agente-conversa.md) e na
[avaliação do planejamento](avaliacoes/2026-10-28-planejamento.md).

## Fluxos implementados

O núcleo reconhece pedidos explícitos em uma gramática restrita:

```text
Salve Leitura hoje das 15h às 16h
Registre Oficina amanhã das 09:15 às 10:45
Agende Caminhada 2030-05-18 das 06h às 07h
Confirmo a sugestão <identificador>
```

O título, data, início e fim vêm do texto humano. O modelo não fornece horários
ausentes e sua resposta não autoriza ferramentas. Outros formatos recebem pedido
de esclarecimento ou indicação de formato ainda não suportado. A gramática não
substitui nem altera o interpretador quick-add atual da agenda.

O sandbox faz as seguintes verificações antes de registrar um evento:

- Datas reais, horários válidos e fim posterior ao início, sem duração padrão.
- Conflitos por sobreposição de intervalos. Eventos adjacentes são permitidos.
- Sugestões pendentes com ID gerado pelo código e versão da agenda capturada.
- Confirmação pelo ID exato e aplicação dos dados armazenados, sem reinterpretá-los.
- Confirmação repetida sem nova alteração e recusa de sugestão desatualizada.
- Identificação de pedidos para devolver o mesmo resultado em uma repetição e
  recusar reutilização do identificador com outro conteúdo.
- Falha simulada antes do commit sem gravação parcial nem consumo da sugestão.

Reorganizar um evento preserva sua identidade, título e duração. Criar uma sugestão
não altera os horários. O código só muda a agenda fictícia após confirmação.
Evento, consumo de sugestão e recibo são atualizados juntos em memória. Um
checkpoint permite retomar sugestões e recibos em outra instância da demonstração.

Esse checkpoint é um recurso de teste. O adaptador de API descrito abaixo valida
persistência e transações em SQLite descartável; produção continua desabilitada.

## Memória e tarefas

O leitor recebe do host uma raiz e rotas de assunto com arquivos permitidos. Lê
`AGENTS.md` da raiz e dos diretórios antes das notas selecionadas. Não faz busca
recursiva e o modelo não escolhe caminhos arbitrários. Índices não são repassados
como instruções para executar ferramentas.

As tarefas abertas são lidas diretamente de `tasks/todo.md`, com referência de
arquivo e linha. Tarefas concluídas ficam fora do contexto devolvido. Uma consulta
nova relê o arquivo, sem manter outra lista persistente de tarefas.

O leitor não escreve nas fontes. Caminhos que escapam da raiz, links simbólicos,
arquivos não regulares e consultas que excedem os limites são recusados. O volume
registrado inclui as leituras dos índices e das tarefas. Caracteres são uma medida
de volume, sem substituir a contagem real de tokens do modelo.

A consulta ao modelo recebe somente as fontes selecionadas, sem acesso ao executor.
A saída precisa respeitar o contrato de consulta e citar fontes disponíveis.
Propostas de escrita, fontes inventadas e algumas alegações de execução são
rejeitadas. A verificação de fontes não prova que a resposta é semanticamente
correta; a qualidade do texto continua exigindo avaliação.

Nesta entrega, a demonstração gera arquivos fictícios em um diretório temporário,
consulta esses arquivos e remove somente esse diretório ao terminar. O leitor não
foi configurado para o vault pessoal.

## Executar e conferir

```bash
npm run typecheck
npm run test:agent
npm run agent:demo
npm run agent:replay
npm run test:agent:api
npm run build
npm run test:agenda
```

`agent:demo` demonstra pedido incompleto, registro, conflito, sugestão de mudança,
confirmação em outra instância, confirmação repetida e recuperação de memória e
tarefas fictícias. Não precisa do Ollama.

`agent:replay` usa as 16 entradas e respostas fictícias da avaliação arquivada.
Compara as ações propostas pelo modelo com a decisão do núcleo sobre o texto humano
original. O relatório fica em `data/pilot/core-replay/report.json`.

Na execução de 28/10, não houve escrita indevida nas 16 entradas. Sete propostas
de escrita do modelo não foram executadas: cinco ocorreram em casos que exigiam
bloqueio e duas eram confirmações válidas em texto livre fora da gramática atual.
Dois pedidos autorizados no formato suportado foram executados. Esse replay mede
os controles de escrita, sem transformar os 7/16 da avaliação do modelo em uma
aprovação geral do agente. Consultas são avaliadas pelo fluxo de contexto separado.

Para conferir a consulta real de memória com o modelo local:

```bash
npm run agent:serve
# Em outro terminal:
npm run agent:query-demo
```

Em 28/10, o `qwen3:4b` respondeu corretamente “35 minutos” e citou `preferencias.md`,
recuperado do diretório fictício. Foram lidos quatro arquivos, incluindo índices e
tarefas: 213 caracteres lidos e 99 devolvidos como contexto. A inferência registrou
754 tokens de entrada, 56 de saída e 8,12 s de latência, incluindo aproximadamente
4,57 s de carregamento do modelo. É uma amostra, sem estimativa de desempenho geral.
O relatório fica em `data/pilot/query-demo/report.json`. O runtime iniciado durante
a validação foi encerrado após o teste.

A validação desta entrega passou em 48 testes do avaliador e do núcleo, checagem
de tipos, build, demonstração, teste do adaptador e regressão da agenda em banco
temporário. Os assets da PWA mantiveram os mesmos hashes. As rotas experimentais
ficam desligadas por padrão; as telas e o comportamento normal foram preservados.

## Adaptador da API em SQLite descartável

`npm run test:agent:api` inicia a API existente com `AGENDA_AGENT_SANDBOX=1` e
banco novo em um diretório `agenda-agent-sandbox-*` diretamente no diretório
temporário do sistema. Vaults e WhatsApp ficam desativados. A configuração recusa
outros locais de banco, atalhos simbólicos ou fontes pessoais habilitadas antes
de abrir o SQLite. O teste também verifica essas recusas.

Somente nesse modo, são registradas as rotas:

- `GET /api/agent/sandbox/state?from=2030-05-14&to=2030-05-14`: estado para a demonstração.
- `POST /api/agent/sandbox/propose`: guarda proposta pendente, sem alterar horários.
- `POST /api/agent/sandbox/request`: valida o pedido humano e executa a ação permitida.

As rotas herdam a autenticação da agenda, incluindo a proteção contra proxy. A
regressão do modo normal confere que a rota de estado responde 404.

Os eventos continuam na tabela `events` e usam as funções existentes de registro
e edição. As tabelas auxiliares do sandbox guardam somente versão, sugestões e
recibos. A leitura do estado, validação, escrita do evento, auditoria, consumo da
sugestão e recibo ficam na mesma transação SQLite. O resultado só indica sucesso
após o commit.

Triggers registram mudanças em eventos e exceções feitas pelas outras rotas da
agenda. Assim, uma edição ou exclusão externa invalida a versão de uma proposta.
O teste também confirma que recibos e sugestões sobrevivem ao reinício, repetições
concorrentes do mesmo pedido devolvem o mesmo resultado sem duplicar o evento, e
uma falha SQL simulada desfaz evento, auditoria e consumo de sugestão juntos.
Não há retentativa automática de escrita após falha.

O adaptador registra eventos únicos com horário mesmo na presença de séries e
eventos de dia inteiro. Para conferir conflitos, expande as ocorrências no
intervalo do pedido, incluindo exceções movidas, exclusões e eventos que atravessam
a meia-noite. Dia inteiro ocupa da meia-noite inicial à meia-noite após a data
final inclusiva, conforme a convenção da agenda. Essas ocupações são projeções
para validar conflitos; não são copiadas para novas linhas no banco.

O estado de diagnóstico inclui eventos únicos e as ocupações do intervalo
`from`/`to` (ou do dia atual da demonstração quando omitido). O intervalo tem
limite de 367 dias. Registro e confirmação calculam seu próprio intervalo a
partir dos dados humanos validados e da proposta armazenada, dentro da transação.
Sugestões de estudo usam as ocupações do dia solicitado. Uma mudança em exceções
continua invalidando propostas anteriores.

O adaptador de eventos únicos não cria séries ou eventos de dia inteiro nem
reorganiza esses tipos. Os planos semanais confirmados têm criação específica
de séries semanais, com a frequência explicitada na prévia; pedidos recorrentes
não são convertidos silenciosamente em eventos únicos.
A expansão de séries diárias e semanais salta o passado preservando COUNT e UNTIL;
atingir o limite de expansão falha em vez de devolver contexto parcial e liberar
uma escrita indevida. O teste fecha os processos e remove somente o diretório
descartável criado por ele.

## Continuidade

Os fluxos de consulta e pedidos agora estão unidos em uma [conversa de demonstração](agente-conversa.md),
com painel do dia, histórico e calendário usando o banco descartável.
O adaptador SQLite foi extraído para `src/server/agent/sandbox-store.ts` para
reutilizar os mesmos controles nas rotas de ferramentas e na conversa.

Pedidos com vários blocos semanais usam `weekly-plan.ts` e `weekly-store.ts`.
Todas as instruções precisam ser interpretadas antes de preparar o plano. A
prévia lista datas, remoções e inclusões e aguarda confirmação. A substituição
de uma semana usa uma única transação e preserva ocorrências de séries fora do
período. A reversão restaura os registros e exceções originais enquanto a versão
da agenda não tiver recebido mudanças posteriores. O teste reproduz o pedido
real reportado, falha no quinto registro, concorrência, reinício e desfazer:
`npm run test:agent:weekly`.

Os próximos ajustes devem ampliar a avaliação da conversa com linguagem de uso
real e esclarecer pedidos incompletos. O design system e as integrações
financeiras continuam fora desta entrega. A escrita no vault e o banco pessoal
permanecem fora das demonstrações atuais.
