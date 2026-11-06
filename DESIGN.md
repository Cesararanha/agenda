---
name: Agenda
description: Um calendário de trabalho claro e quieto, em que a cor conta o que já passou, o que vem e o que está acontecendo.
colors:
  texto: "#191919"
  branco: "#FFFFFF"
  barra-lateral: "#F7F7F5"
  hover: "#F1F1EF"
  linha: "#E6E6E3"
  linha-da-grade: "#EEEEEC"
  fim-de-semana: "#FAFAF8"
  apoio: "#666664"
  agora: "#D4441F"
  foco: "#2F6FDB"
  alerta: "#B4341A"
typography:
  titulo-da-tela:
    fontFamily: "-apple-system, BlinkMacSystemFont, SF Pro Text, Segoe UI, Roboto, sans-serif"
    fontSize: "24px"
    fontWeight: 700
    letterSpacing: "-0.025em"
  corpo:
    fontFamily: "-apple-system, BlinkMacSystemFont, SF Pro Text, Segoe UI, Roboto, sans-serif"
    fontSize: "14px"
    lineHeight: 1.4
  compromisso:
    fontFamily: "-apple-system, BlinkMacSystemFont, SF Pro Text, Segoe UI, Roboto, sans-serif"
    fontSize: "12px"
    fontWeight: 600
  hora:
    fontFamily: "-apple-system, BlinkMacSystemFont, SF Pro Text, Segoe UI, Roboto, sans-serif"
    fontSize: "11px"
rounded:
  chip: "4px"
  bloco: "5px"
  botao: "7px"
  dialogo: "14px"
---

## Overview

Ferramenta de uso diário. As referências são o Notion Calendar e o Fantastical, vistos de perto em 2026-11-06. Do painel do segundo cérebro vêm só as cores, por decisão do dono: nenhuma forma, tipografia ou composição dele. O tema é sempre claro.

## Colors

A cor conta o estado do compromisso. Ainda por vir: fundo claro da cor da categoria, texto escuro da mesma cor e barrinha na cor cheia. Já passou: o mesmo bloco, desbotado. Acontecendo agora: a cor cheia toma o bloco e a linha dele na barra lateral. Os tons são calculados em `src/shared/cores.ts` a partir da paleta de 12, com contraste testado para qualquer escolha do dono.

Cada categoria tem a cor que o dono escolhe. As de fábrica são Trabalho roxo, Faculdade turquesa, Estudo amarelo, Projeto vermelho-laranja, Saúde rosa, Pessoal azul e Outro cinza.

O vermelho é o hoje e o agora: o número do dia, a linha da hora e a hora na régua. Fora disso, a interface é preto, branco e cinza.

## Typography

A fonte do sistema, a mesma família nativa do Fantastical no Mac e no iPhone, com algarismos tabulares. O título da tela combina uma parte forte e uma leve ("Novembro 2026"). A página não baixa fonte.

## Layout

No desktop, a barra lateral clara de 256px ocupa toda a altura, com o mês pequeno, a lista do que vem por dia, Sem horário e a legenda das cores. O título, o campo de marcar, as visões e a navegação ficam em uma só barra acima do calendário. Até 1080px a barra lateral sai. Até 760px o campo de marcar vai para o pé da tela, ao alcance do polegar. A agenda abre sempre na semana, em qualquer aparelho.

Semana e dia usam a mesma grade de horas, de 7h a 22h, que cresce só se houver compromisso fora disso. Ela abre com o agora à vista. Sábado e domingo têm um fundo levemente diferente.

## Elevation & Depth

Sem sombras, salvo o diálogo, o bloco sendo arrastado e a opção escolhida entre Dia, Semana e Mês. A estrutura vem de linhas finas.

## Components

Compromisso aberto: o título vem primeiro, sem rótulo, sobre o tom da categoria, que muda na hora ao escolher outra (Apple Calendar). O resto são linhas com ícone e campos sem rótulo, com a duração ao lado da hora e Dia inteiro e Repetir como opções discretas (Notion Calendar e Fantastical). Mudar o início leva o fim junto. O alcance de um compromisso que repete só é perguntado ao salvar ou remover, e remover sempre pede confirmação.

Categorias são do dono: ele adiciona, remove e escolhe a cor em Editar categorias. Outro não sai, porque recebe os compromissos das removidas.

Compromisso em bloco claro com cantos de 5px, título primeiro e hora depois. Em bloco curto, os dois ficam na mesma linha. A linha do agora é fina em toda a semana e forte no dia de hoje, com a hora na régua. Na lista lateral, o ponto de 8px liga o compromisso à cor. Atalhos: H hoje, D S M visões, setas navegam, N marca, Esc fecha.

## Do's and Don'ts

- Faça: mantenha o agora visível na semana e no dia.
- Faça: use a barrinha colorida só no bloco de calendário; em lista, o ponto.
- Não faça: cor fora da paleta de 12.
- Não faça: mostrador, anel, ladrilho ou outra forma do painel.
- Não faça: fonte mono como enfeite, nem recurso remoto de fonte ou de script.
