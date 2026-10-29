# Agente César 2.0

Assistente pessoal local em desenvolvimento, construído sobre uma agenda existente.
O protótipo combina consultas de contexto com um modelo local, ferramentas de
agenda e controles de confirmação, conflitos, repetição e transações em SQLite.

A demonstração usa dados fictícios e roda separada da agenda pessoal. O modelo
`qwen3:4b` é pré-treinado e executado com Ollama; não foi feito fine-tuning.
As operações de calendário passam por interpretadores e validações em TypeScript.
O modelo participa das consultas de contexto, identifica o título em alguns
pedidos de registro e separa blocos de planos com vários compromissos. Os campos
interpretados passam por validação independente e os planos aguardam confirmação.
Quem grava os compromissos é a API no SQLite;
o modelo não recebe acesso direto à escrita.

- [Apresentação para portfólio: arquitetura, evidências e roteiro](docs/portfolio.md).
- [Como abrir a demonstração e quais pedidos experimentar](docs/agente-conversa.md).
- [Preparação do modelo local e avaliação](docs/agente-piloto.md).

Com o ambiente preparado, `npm run agent:app` abre a demonstração em
`http://127.0.0.1:8790`, sem exigir o vault pessoal. O restante deste README
documenta a agenda que serve de base e suas integrações originais. Essas
integrações não são habilitadas na demonstração do agente.

## Agenda que serve de base

Agenda local do Cesar. Roda no proprio Mac, guarda tudo num SQLite na pasta `data/`
e nao manda nada pra nuvem. Quatro portas de entrada pros mesmos dados:

| Porta | O que e |
|---|---|
| PWA | semana, dia e mes no navegador; instalavel no iPhone e no Android |
| API REST | `/api/*`, usada pelo PWA e por qualquer script |
| MCP | as IAs (Claude Code, Codex, qualquer cliente MCP) leem e escrevem na agenda |
| WhatsApp | manda "semana" ou "amanha 14h dentista" e a agenda responde |

O vault entra **somente como leitura**: os prazos de `tasks/todo.md` e de
`faculdade/<disciplina>/overview.md` viram marcos de dia inteiro. Nada e escrito no
vault e nada do vault e copiado pra dentro deste repo.

---

## Rodar

```bash
npm install
cp .env.example .env     # ajuste AGENDA_VAULTS e gere um AGENDA_TOKEN
npm run dev              # API em :8787 e PWA em :5173, com recarga
```

Pra usar de verdade (um processo so, PWA ja compilada):

```bash
npm run build && npm start   # tudo em http://localhost:8787
```

O banco nasce em `data/agenda.db`. Backup e copiar esse arquivo.

---

## Usar

**Barra de cima.** Escreva e aperte Marcar:

```
amanha 14h dentista
27/10 15h-17h estudar Salesforce
toda terca 19h aula de IA
seg qua sex 7h academia
todo dia 8h daily
```

Ele entende `hoje`, `amanha`, dia da semana, `dd/mm`, `AAAA-MM-DD`, `14h`, `14:30`,
`14h-16h`, `toda <dia>`, `todo dia` e varios dias soltos (`seg qua sex` vira rotina
semanal). A categoria sai de palavras como aula, prova, academia, reuniao, Colete.

**Arrastar** um bloco na semana muda horario e dia. Num compromisso que repete,
arrastar mexe so naquele dia; o resto se escolhe no dialogo (So esse dia / Daqui pra
frente / A serie toda).

**Botao Vault** rele os prazos do vault e atualiza os marcos.

---

## Celular

Na mesma rede wi-fi:

```bash
npm run link
```

Isso imprime o endereco com o token embutido (`http://192.168.x.x:8787/?token=...`).
Abra no celular uma vez: o token fica guardado no aparelho e some da barra de endereco.
No iPhone, Compartilhar > Adicionar a Tela de Inicio, e ela abre como app.

A tela abre sem token, mas **os dados so vem com ele**: sem token a API responde 401.

**De qualquer rede** (e pra o WhatsApp funcionar), exponha o Mac com um tunel:

```bash
npm run tunel      # cloudflared tunnel --url http://localhost:8787
```

Isso imprime uma URL https publica, sem precisar de conta. Ela muda a cada vez que o
tunel sobe. Pra um endereco fixo, crie um tunel nomeado na conta Cloudflare
(`cloudflared tunnel create agenda`) e aponte um subdominio seu.

Com o tunel no ar, `npm run link` ja mostra a URL publica junto com a do wi-fi.

Enquanto o tunel estiver no ar, qualquer pessoa com a URL **e** o token entra: por isso
o `AGENDA_TOKEN` nao pode ficar vazio.

### Por que loopback nao basta
`AGENDA_ALLOW_LOCAL=1` dispensa o token pra requisicao vinda do proprio Mac. Mas o
`cloudflared` roda aqui e conecta de 127.0.0.1: confiar so no IP deixava a agenda
**aberta na internet sem token** assim que o tunel subia. Entao a isencao cai se a
requisicao trouxer qualquer cabecalho de encaminhamento (`x-forwarded-*`,
`cf-connecting-ip`, `cf-ray`, `x-real-ip`, `forwarded`, `true-client-ip`).

Sempre que mexer nas regras de acesso, teste **pela URL publica**, nao so por localhost:

```bash
npm run smoke                        # local
npm run smoke https://SEU-TUNEL      # pela internet, que e o teste que vale
```

## Sempre no ar

Pra agenda subir sozinha no login e se reerguer se cair:

```bash
cp launchd/com.cesararanha.agenda.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.cesararanha.agenda.plist
```

Conferir: `launchctl list | grep agenda` e `tail -f logs/agenda.log`.
Pra desligar: `launchctl unload ~/Library/LaunchAgents/com.cesararanha.agenda.plist`.

## IAs (MCP)

Ja registrado no Claude Code com escopo de usuario (vale em todos os projetos):

```bash
claude mcp add agenda --scope user -- npx tsx "$PWD/src/mcp/server.ts"
```

Conferir: `claude mcp get agenda`. Pra tirar: `claude mcp remove agenda -s user`.

O servidor MCP fala com a API por HTTP (`AGENDA_URL`, padrao `http://127.0.0.1:8787`),
entao a agenda precisa estar rodando. Ferramentas: `agenda_contexto`, `agenda_listar`,
`agenda_hoje`, `agenda_semana`, `agenda_criar`, `agenda_criar_texto`, `agenda_editar`,
`agenda_remover`, `agenda_resumo`, `agenda_sincronizar_vault`.

Pra IA que nao fala MCP, a API REST resolve: `GET /api/summary?from=&to=` devolve a
agenda em texto, e `POST /api/quick-add {"text": "..."}` marca.

---

## WhatsApp

Fica desligado enquanto `WHATSAPP_ACCESS_TOKEN` estiver vazio. Pra ligar:

1. **Entre primeiro.** Abra developers.facebook.com e clique em **Login** (canto
   superior direito), com sua conta do Facebook. Deslogado, o painel de apps mostra
   "Sorry, the link you followed may be broken": nao esta quebrado, e so que a pagina
   nao monta sem sessao. Na primeira vez a Meta pede o registro de desenvolvedor
   (aceitar os termos e confirmar e-mail ou telefone).
   Depois: **My Apps > Create App**, e adicione o produto **WhatsApp**. O numero de
   teste que a Meta da ja serve: fala com ate 5 numeros que voce cadastrar, e o seu e
   um deles. Nao precisa de verificacao de empresa.
2. Preencha o `.env` sem abrir o arquivo (os segredos nao aparecem na tela nem no
   historico do shell; o verify token ele gera pra voce):
   ```bash
   npm run whatsapp:setup
   ```
   Os valores sao: verify token (voce inventa), access token (WhatsApp > API Setup),
   App Secret (Configuracoes do app > Basico), Phone number ID (API Setup) e o seu
   numero so com digitos (5582...). Reinicie o servidor depois.
3. Confira tudo de uma vez (ele testa as credenciais na Meta de verdade):
   ```bash
   npm run tunel                        # num terminal, anote a URL
   npm run whatsapp https://SUA-URL     # noutro: valida e monta o webhook
   ```
4. Cadastre o webhook que ele imprimir, assinando o campo `messages`, e mande `ajuda`
   pro numero.

Sem a Meta, da pra testar o interpretador:

```bash
curl -s -X POST http://127.0.0.1:8787/api/whatsapp/simulate \
  -H 'content-type: application/json' -d '{"text":"semana"}'
```

### Seguranca do webhook
Cada POST da Meta vem assinado em `X-Hub-Signature-256` (HMAC-SHA256 do corpo bruto com
o App Secret). O servidor confere a assinatura e **falha fechada**: sem
`WHATSAPP_APP_SECRET`, todo POST leva 403. Toda rejeicao fica na tabela `audit`.

So o numero em `WHATSAPP_ALLOWED_FROM` e atendido; o resto e registrado e ignorado.

## SENAI

O cofre do SENAI (`~/senai-cerebro`) **nao entra aqui**. A regra do vault e que nada
do trabalho sai do cofre, e o cofre so abre pela conta do SENAI.

`AGENDA_VAULTS` aceita varias fontes (`rotulo=caminho`, separadas por virgula) de
proposito: o jeito certo de ter a agenda do SENAI e rodar **outra instancia** na conta
do SENAI, com o `.env` dela apontando pro cofre e um `AGENDA_DB` proprio. Mesmo codigo,
bancos separados, regra intacta.

---

## Piloto do Agente César 2.0

A fase 1 tem um avaliador local por linha de comando com Ollama e `qwen3:4b`,
usando somente dados fictícios. Consulte [preparo, execução e limites do piloto](docs/agente-piloto.md).
O piloto não altera as rotas, telas ou dados da agenda.

O [núcleo em desenvolvimento](docs/agente-nucleo.md) acrescenta controles de
registro e confirmação, contexto local em modo de leitura e demonstrações
fictícias: `npm run agent:demo` e `npm run agent:replay`.

Para experimentar o painel com conversa, execute `npm run agent:app`.
Veja os [exemplos e limites da demonstração](docs/agente-conversa.md).
Pedidos fora da gramática direta passam por identificação de intenção com o
modelo local. Consulte a [avaliação de pedidos novos e continuidade da conversa](docs/avaliacoes/2026-10-28-confiabilidade.md)
e reproduza os diálogos com `npm run agent:eval:dialogues`.

## Estrutura

```
src/shared/      datas, recorrencia e tipos (servidor e PWA usam os mesmos)
src/server/      API Fastify, SQLite, importador de vault, WhatsApp
src/mcp/         servidor MCP
src/web/         PWA em React
```

Datas sao guardadas como hora de parede (`2026-10-27T14:00`), sem fuso: a agenda e de
uma pessoa so, num lugar so, e isso elimina a classe inteira de bugs de UTC.

Recorrencia e um subconjunto do RRULE do iCalendar:
`FREQ=DAILY|WEEKLY|MONTHLY`, com `INTERVAL`, `BYDAY`, `UNTIL` e `COUNT`. Uma ocorrencia
que sai da serie vira linha em `overrides`; uma apagada entra em `exdates`.
