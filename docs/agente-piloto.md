# Agente César 2.0: piloto local (fase 1)

O piloto mede um modelo local com cenários inventados. Roda por linha de comando no
mesmo repositório da agenda. Não registra rotas, altera telas, importa o servidor,
abre SQLite, lê o `.env` da agenda ou consulta arquivos pessoais. Não executa
ferramentas: suas respostas são propostas avaliadas, nunca ações reais.

Veja a [primeira medição de 28/10/2026](avaliacoes/2026-10-28.md): 7/16 avaliações
aprovadas após acrescentar exemplos no prompt, com falhas críticas ainda presentes.
O trabalho seguinte está no [núcleo da fase 2](agente-nucleo.md), com controles
no código e demonstrações fictícias. A nota do modelo permanece a mesma.

## Preparar o ambiente

Requisitos: Node 24 (o mesmo ambiente da agenda) e Ollama. No macOS com Apple Silicon,
é possível usar a distribuição oficial localmente, sem instalar um serviço no login:

```bash
npm ci
mkdir -p data/pilot/runtime
curl -fL https://github.com/ollama/ollama/releases/download/v0.40.12/ollama-darwin.tgz \
  -o data/pilot/runtime/ollama-darwin.tgz
shasum -a 256 data/pilot/runtime/ollama-darwin.tgz
# SHA-256 esperado para esse arquivo:
# 1d1b4c2cf40d2a239f9b08a77384830800a8542c744a55f47247f9baf85b55d2
tar -xzf data/pilot/runtime/ollama-darwin.tgz -C data/pilot/runtime
npm run agent:serve
```

O checksum acima foi conferido com o digest publicado na distribuição oficial.
O runtime não entra no Git. Também é possível instalar o Ollama pelo
[site oficial](https://docs.ollama.com/macos); `agent:serve` usa o executável local
quando existir e, caso contrário, procura `ollama` no PATH.

`agent:serve` inicia um processo em primeiro plano, com `OLLAMA_NO_CLOUD=1`, escutando
em `127.0.0.1:11434`. Os modelos ficam em `data/pilot/models/`. O Ollama pode gerar
uma chave própria em `~/.ollama` na primeira execução. Use Ctrl+C para encerrar.
Evite iniciar outro servidor Ollama na mesma porta.

Em outro terminal, com o servidor rodando:

```bash
data/pilot/runtime/ollama pull qwen3:4b
# Se usar a instalação do sistema: ollama pull qwen3:4b
npm run agent:check
npm run test:agent
npm run agent:eval
# Para avaliar variação entre tentativas:
npm run agent:eval -- --repeats 3
```

O download do modelo usa a internet. As inferências do piloto são locais. Não há
fallback para nuvem. O cliente aceita apenas HTTP em loopback literal, recusa
redirecionamentos e modelos identificados como remotos. O nome de modelo padrão
continua `qwen3:4b`, ponto de partida da medição.

Configuração opcional por variáveis do shell, sem editar o `.env` da agenda:

```bash
AGENT_MODEL=qwen3:4b AGENT_TIMEOUT_MS=120000 npm run agent:eval
# AGENT_OLLAMA_URL padrão: http://127.0.0.1:11434
```

## O que é avaliado

Há 14 cenários: registro explícito, horário ausente, duração ausente, conflito,
sugestão pendente, confirmação identificada, confirmação repetida, agenda alterada
após sugestão, falha de ferramenta, retomada em conversa nova, confirmação de ID
desconhecido, recuperação de preferência, memória ausente e instrução maliciosa em
uma nota fictícia. Todos usam uma data fixa de 2030 e dados inventados no código.

O contrato separa a intenção (`kind`), o evento proposto, a sugestão referenciada,
as fontes utilizadas e a mensagem. JSON é validado em código. O juiz compara
ação, evento completo, ID e fontes, verifica fatos esperados de memória e procura
algumas alegações indevidas de execução. Uma falha torna a avaliação reprovada e o
comando encerra com código 1. Respostas truncadas, JSON inválido, HTTP e timeout
também são falhas, sem executar nada. Não há repetição automática de ações.

Retomada e recuperação de preferência recebem dois contextos: um recorte preparado
e uma versão com histórico fictício extra. São 16 inferências por repetição. As
respostas esperadas ficam no avaliador e não são enviadas ao modelo. Cada chamada
começa uma conversa nova, usando somente o snapshot correspondente.

Temperatura 0, seed 42, contexto de 4096 tokens, limite de 512 tokens de saída,
`think: false` e `stream: false` são registrados para tornar a medição comparável.
Isso não garante determinismo entre versões, máquinas ou execuções.

## Relatórios e interpretação

Cada avaliação gera `data/pilot/reports/<instante>/report.json` e `report.md`.
O JSON é atualizado após cada tentativa para preservar resultados parciais.
Sem servidor ou modelo, fica um relatório de ambiente bloqueado, sem inventar
medições. Esses arquivos, modelos e runtime ficam sob `data/`, ignorado pelo Git.

São registrados:

- Modelo, digest, versão do Ollama, máquina, opções, revisão Git e hashes do código,
  prompt, contrato e fixtures, além das entradas fictícias para reprodução.
- Saída bruta fictícia, aprovação e motivos de reprovação de cada tentativa.
- Latência observada de ponta a ponta, p50/p95, carregamento e tempos do Ollama.
- Tokens de entrada e saída fornecidos pelo Ollama, somando todas as tentativas,
  inclusive as versões com histórico e repetições. Ausência de métrica vira `null`.
- Tamanho do modelo carregado e alocação de GPU via `/api/ps` após cada chamada,
  além do RSS do processo avaliador. Não representam pico de RAM do sistema.

A primeira chamada pode incluir carregamento frio; as seguintes tendem a aproveitar
o modelo carregado. Não compare um único p95 como se fosse um benchmark abrangente.
Caracteres de entrada também são registrados, mas não substituem tokens.

O recorte de contexto é manual nesta fase. A comparação não mede busca automática,
manutenção do vault, trocas reais de conta, sessões longas ou economia total do
produto. A validação da mensagem é parcial: revise a saída bruta antes de aceitar
conclusões sobre qualidade. O piloto mantém `readyForRealActions: false` mesmo
quando todas as avaliações passam.

## Preservação da agenda e próximo limite

```bash
npm run typecheck
npm run build
npm run test:agent
npm run test:agenda
```

`test:agenda` abre um processo separado em porta temporária de loopback, com banco
descartável, vaults desativados e credenciais fictícias. Verifica PWA, autenticação
de proxy, webhook sem assinatura, CRUD, recorrência e quick-add. Encerra o processo
e remove somente o diretório temporário criado pelo próprio teste.

A fase 1 precisa de medições revisadas e limitações conhecidas. Falhas críticas
precisam orientar os controles da fase 2: autorizações, conflitos, idempotência,
versão da sugestão e resultado da ferramenta devem ser conferidos por código antes
de qualquer escrita. Esta fase não habilita esses fluxos sobre dados pessoais e
não altera o comportamento atual da agenda.

Referências técnicas: [API de conversa](https://docs.ollama.com/api/chat),
[modelos carregados](https://docs.ollama.com/api/ps) e
[modelo de referência](https://ollama.com/library/qwen3:4b).
