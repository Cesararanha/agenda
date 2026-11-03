# Entrega local verificada, 29/10/2026

Este é o registro anterior ao incremento de alterações por conversa. A situação
mais recente está na [avaliação do novo fluxo](2026-10-29-alteracoes-conversa.md),
que acrescenta mover e cancelar pelo título e dia, com confirmação e desfazer.

Esta revisão fecha a primeira entrega funcional de demonstração: conversa,
painel e calendário sobre a mesma API e o mesmo SQLite fictício. Não habilita
o agente no banco pessoal. O ambiente principal de código é
`/Users/cesararanha/dev/agenda`.

## O que foi conferido

| Fluxo | Resultado e evidência |
| --- | --- |
| Criar pela conversa, confirmar, editar no calendário e consultar novamente | Um compromisso, mesmo ID e horário atualizado. Conferido na interface e na regressão de conversa. |
| Sugestão, consulta intermediária e cancelamento | O estudo sugerido para 15:30–16:05 não foi registrado; a confirmação posterior foi recusada. Conferido na interface e na integração. |
| Criar rotina semanal | Três séries para segunda, quarta e sexta, sem data final, com frequência explícita na prévia. |
| Editar somente uma ocorrência | Treino de 02/11 passou para 08:00–09:00; o de 09/11 continuou em 07:00–08:00. |
| Excluir somente uma ocorrência | Revisão de 06/11 removida; revisão de 13/11 preservada. A conversa respeitou a exclusão. |
| Substituir uma semana e desfazer | Duas remoções e cinco inclusões aplicadas; desfazer restaurou exatamente as ocorrências anteriores, incluindo exceções e séries fora da semana. |
| Proteger alterações posteriores | Desfazer um plano antigo após editar no calendário foi recusado, sem sobrescrever a edição. |
| Editar daqui para frente | Ciclo diário de três ocorrências manteve três: 16/11 às 10:00 e 17–18/11 às 11:00. Conferido no diálogo do calendário e pela API. |
| Série finita com exceções | COUNT e UNTIL preservados, exceções e exclusões futuras transferidas corretamente; exclusão futura remove também suas exceções. Regressão da agenda. |
| Falha ao dividir uma série | Regra inválida não corta a série original: rollback cobre divisão, exceções e auditoria. Regressão da agenda. |
| Escopos de edição | Campos da série não são ignorados no escopo de uma ocorrência; resposta identifica a ocorrência editada mesmo ao movê-la para uma data já ocupada pela série. |
| Erro, repetição e retomada | Integrações cobrem indisponibilidade simulada do modelo, proposta desatualizada, recibos, concorrência, reinício, resposta perdida e rollback. |

A aceitação de interface usou uma instância separada, descartável, em 8791.
A demonstração do usuário em 8790 foi preservada. As ações de teste não abriram
vaults nem alteraram a agenda pessoal.

## Correções encontradas nesta conferência

Antes dos ajustes, dividir uma série de cinco ocorrências criava sete. Uma
segunda reprodução enviou uma regra inválida: a API respondeu 400, mas sobraram
somente duas das cinco ocorrências originais. Esses resultados foram reproduzidos
em uma instância inteiramente fictícia.

Edições e exclusões agora usam SAVEPOINT, inclusive dentro das transações dos
planos do agente. A divisão preserva a quantidade restante e a data final,
transfere exceções e exclusões futuras e conserva o passado. Uma data fora da
série é recusada. Mudança incompatível com exceções recebe orientação antes
de qualquer escrita.

O formulário preserva a regra original quando a configuração de repetição não
muda, incluindo COUNT e INTERVAL que não têm campos próprios no diálogo.
Intervalos vazios ou com fim anterior/igual ao início recebem erro sem salvar.
Os controles de categoria, dia inteiro e repetição indicam o escopo necessário.
Notificações antigas são limpas ao voltar da conversa para o calendário.

Também foi acrescentada uma ajuda curta na demonstração para distinguir as
ações da conversa e os controles disponíveis no calendário. A correção de grafia
de títulos e a regressão de sincronização estão no
[registro anterior desta data](2026-10-29-sincronizacao.md).

## Validações finais

| Verificação | Resultado |
| --- | --- |
| Tipos e build | Aprovados |
| Testes unitários | 134/134 |
| Integrações de API do agente, conversa, planos semanais e agenda | Quatro aprovadas, com SQLite temporário e modelos simulados quando necessário |
| Linguagem com Qwen real | 54/54 |
| Planejamento com Qwen real | 15/15 e três adicionais |
| Diálogos com Qwen real | 12/12, cinco adicionais e três previamente separados |
| Pedidos novos de aceitação | 6/6 |

Os quatro conjuntos de diálogos somam 26 casos e 37 mensagens. Vários casos já
participaram do desenvolvimento; os seis da aceitação foram escritos nesta
conferência. Isso não mede uma taxa geral de compreensão de linguagem natural.

A primeira execução da aceitação marcou 5/6 por exigir `kind=ask` quando uma
preferência não constava nas fontes. A resposta real informou corretamente que
não havia dados sobre a cor preferida, mas usou `kind=answer`. O critério foi
corrigido para aceitar resposta ou pergunta que reconheça a ausência e não
invente uma cor. Não houve mudança no prompt nem nos pesos para fazer esse caso
passar. A resposta ainda pode acrescentar contexto desnecessário; a avaliação
não transforma essa observação em uma promessa de respostas perfeitas.

Relatórios completos finais ficam em `data/pilot/`, ignorados pelo Git:

- `language/1793311122165-qwen.json`;
- `planning/1793311146879-qwen.json` e `1793311155014-qwen-holdout.json`;
- `dialogues/1793311159233-qwen.json`, `1793311165903-qwen-holdout.json`,
  `1793311167814-qwen-unseen.json` e `1793311174259-qwen-acceptance.json`.

O antigo resultado de 7/16 no contrato original do piloto continua registrado.
Esses novos resultados são de fluxos da aplicação, combinando código, ferramentas
e modelo pronto. Não houve treinamento ou ajuste dos pesos do Qwen.

## Memória observada

Após as avaliações, o macOS informou RSS pontual de 3.280.832 KiB para o processo
do modelo (aproximadamente 3,13 GiB) e 26.640 KiB para o daemon do Ollama
(aproximadamente 26 MiB). O Ollama informou 3.181.631.242 bytes de residência do
modelo, com contexto de 4.096 tokens. São métricas diferentes, que não devem ser
somadas como memória física exclusiva, especialmente com a memória unificada do Mac.
Não foi medido pico, consumo de energia ou CPU por resposta. A amostra completa
fica em `data/pilot/acceptance/2026-10-29-memoria.json`.

## Como executar e conferir

Use Node 24, as dependências instaladas e o Ollama/modelo preparados conforme o
[guia do piloto](../agente-piloto.md).

```bash
npm run agent:verify
npm run agent:verify:model
npm run agent:app
```

O primeiro comando confere o software com dados temporários e não exige o Qwen.
O segundo verifica os fluxos avaliados com o modelo local disponível. Nenhum
deles baixa dependências, treina pesos ou ativa escrita em dados pessoais.
`agent:app` abre a demonstração em `http://127.0.0.1:8790`; se já estiver aberta,
use essa instância ou escolha outra porta com `AGENT_DEMO_PORT`.

## Limites desta entrega

- A conversa consulta agenda, tarefas e preferências, registra eventos únicos,
  prepara planos semanais e cria rotinas semanais confirmadas.
- Edição e exclusão de compromissos existentes por nome não estão implementadas
  de forma geral na conversa. O calendário fornece essas operações e os três
  escopos de recorrência; as consultas do agente usam o resultado atualizado.
- Uma mudança de dia, padrão ou tipo de horário com exceções futuras exige revisão.
  A troca entre dia inteiro e horário definido também é recusada em séries com
  ocorrências editadas, para não tornar suas exceções incompatíveis.
- COUNT e INTERVAL existentes são preservados quando não há mudança na repetição;
  não há campos próprios para editar esses números no formulário atual.
- A confirmação de um plano sempre usa a versão atual; desfazer não sobrescreve
  alterações posteriores. A conferência de conflitos de novas rotinas cobre 365
  dias e os eventos únicos conhecidos além dessa janela, conforme a prévia.
- O agente ainda opera em demonstração isolada. Integração supervisionada com
  dados pessoais, finanças, viagens, notificações e disponibilidade remota
  permanecem etapas posteriores do plano-base.

Capturas fictícias da conferência ficam em `data/pilot/screenshots/`.
Este fechamento documenta uma entrega local verificável dentro desse escopo.
