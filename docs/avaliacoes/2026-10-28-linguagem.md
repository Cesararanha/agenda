# Avaliação de linguagem da conversa, 28/10/2026

Objetivo: medir as falhas de interpretação reportadas no uso da demonstração e
ampliar os pedidos aceitos preservando autorização, dados completos e conflitos.
Todos os dados são fictícios. Nenhum compromisso pessoal foi consultado ou alterado.

## Resultados observados

| Execução | Resultado |
|---|---:|
| Código anterior, mesmo conjunto de linguagem | 27/47 |
| Código com datas, intervalos e roteamento ampliados, sem ajuda do modelo | 40/47 |
| Código ampliado e Qwen real na extração restrita de títulos | 47/47 |
| Três pedidos adicionais separados dos exemplos do prompt | 3/3 |

O conjunto principal contém consultas do dia, semana e tarefas, 15 pedidos de
registro, seis casos com dados ausentes ou inválidos, seis casos de negação,
condição ou autorização, três planos semanais e uma pergunta de preferência.
As verificações conferem tipo de resposta, campos do evento, período de consulta,
fontes e ausência de gravação indevida, conforme o cenário.

O Qwen foi chamado em sete pedidos do conjunto principal e nos três adicionais.
Nos sete principais, a duração retornada pelo Ollama foi de 0,318 a 4,940 segundos;
a primeira chamada incluiu 4,376 segundos de carregamento. Nos três adicionais,
foi de 0,377 a 0,396 segundos. Esses tempos são amostras locais, sem promessa de
desempenho em outras máquinas ou estimativa de energia.

## O que mudou

- Datas de registro aceitam dia da semana e formato brasileiro, além das relativas.
- Intervalos aceitam formas como `16h-17h` e `entre 8h e 9h`.
- Perguntas sobre semana e pendências seguem para suas fontes corretas.
- Pedidos naturais não reconhecidos pela gramática direta podem usar o Qwen
  somente para apontar o título já escrito pelo humano. Data e horário são
  resolvidos e validados pelo código; a interpretação gera proposta para confirmar.
- A ausência ou falha na extração do título preserva dia e horários para esclarecer.
- Negação, condição, dados inválidos, título inventado e saídas de ação do modelo
  são recusados antes da gravação.

## Reprodução e limites

```bash
npm run agent:eval:language
npm run agent:eval:language -- --with-model
npm run agent:eval:language -- --with-model --holdout
npm run test:agent
npm run test:agent:chat
npm run test:agent:weekly
npm run test:agent:api
npm run test:agenda
```

Sem `--with-model`, os sete pedidos que dependem dessa extração pedem o título
ao usuário; portanto essa execução não deve passar os 47 casos. Os relatórios
com entradas, saídas, falhas e métricas ficam em `data/pilot/language/`, ignorado
pelo Git. O corpus está em `src/agent/evals/language-cases.ts`.

O avaliador de linguagem usa armazenamento em memória, simula a ferramenta de
planos e simula a resposta de preferência. Portanto 47/47 não mede execução real
de planos no SQLite nem a qualidade de memória do modelo. As integrações separadas
exercitam SQLite temporário, confirmação, recorrência, rollback e agenda normal;
a integração de conversa usa um Ollama fictício para testar respostas adversas.
O total de testes unitários do avaliador, núcleo e recorrência é 108.

O conjunto principal foi usado para orientar os ajustes. Os três pedidos separados
não foram usados como exemplos do prompt, mas são uma amostra pequena, sem validade
estatística para afirmar compreensão geral. A avaliação anterior do modelo
(7/16) continua válida para aquele contrato e não é substituída por esta medição do
fluxo híbrido. Não houve treinamento ou alteração de pesos do Qwen.
