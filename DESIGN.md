---
name: Agenda
description: Um calendário em preto e branco, com o agora em azul.
colors:
  preto: "#0E0E0E"
  preto-ladrilho: "#1C1C1C"
  branco: "#FFFFFF"
  cinza-texto: "#666666"
  cinza-linha: "#E7E7E7"
  cinza-bloco: "#D9D9D6"
  hover-linha: "#F6F6F4"
  azul-agora: "#2F6FDB"
  amarelo: "#F6C700"
  vermelho: "#E5532D"
  alerta: "#B4341A"
  hover-escuro: "#333333"
  hover-ladrilho: "#262626"
  rotulo-claro: "#B9B9B9"
  rotulo-amarelo: "#3A3100"
typography:
  rotulo:
    fontFamily: "JetBrains Mono, ui-monospace, Menlo, monospace"
    fontSize: "11px"
    letterSpacing: "0.04em"
  numero:
    fontFamily: "JetBrains Mono, ui-monospace, Menlo, monospace"
    fontSize: "56px"
    fontWeight: 300
    letterSpacing: "-0.04em"
  corpo:
    fontFamily: "Avenir Next, Helvetica Neue, system-ui, sans-serif"
    fontSize: "14px"
    lineHeight: 1.45
  titulo-do-dia:
    fontFamily: "Avenir Next, Helvetica Neue, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 500
    letterSpacing: "-0.02em"
  titulo-de-dialogo:
    fontFamily: "Avenir Next, Helvetica Neue, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 500
  item:
    fontFamily: "Avenir Next, Helvetica Neue, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 500
  apoio:
    fontFamily: "Avenir Next, Helvetica Neue, system-ui, sans-serif"
    fontSize: "13px"
  legenda:
    fontFamily: "Avenir Next, Helvetica Neue, system-ui, sans-serif"
    fontSize: "12px"
  bloco-no-telefone:
    fontFamily: "Avenir Next, Helvetica Neue, system-ui, sans-serif"
    fontSize: "9.5px"
rounded:
  marca: "2px"
  chip: "4px"
  bloco: "6px"
  botao: "8px"
  ladrilho: "10px"
  trilho: "16px"
---

## Overview

Mesma família visual do painel pessoal do dono: branco, preto, linhas finas e números em fonte mono. Aqui é uma ferramenta de trabalho, então o calendário continua no formato que qualquer pessoa reconhece.

## Colors

Azul é o agora: a linha da hora, o ladrilho Agora e o rótulo do compromisso em andamento. Amarelo é Estudo e também o ladrilho Próximo. Vermelho-laranja é Projeto. Trabalho e Faculdade são pretos, e Saúde, Pessoal e Outro são cinza. A cor de cada compromisso vem da categoria, escrita por extenso na tela do dia e ao abrir o compromisso. No tema escuro, o preto vira quase branco e o cinza escurece; os tons vêm da tela Mapa do painel.

## Typography

Hora, data e número em JetBrains Mono, com algarismos tabulares. O resto em Avenir Next. A página não baixa fonte: onde a mono não existe, usa a mono do sistema.

## Layout

No desktop, o trilho preto de 276px fica à esquerda, com Agora, Próximo, Restam hoje e Sem horário. O calendário ocupa o resto. Até 1080px o trilho sai. Até 760px a barra de marcar vai para o pé da tela, ao alcance do polegar, e a agenda abre no dia de hoje, com a faixa dos 7 dias no topo. A semana cabe na largura, sem rolagem lateral.

## Elevation & Depth

Sem sombras, salvo a do diálogo. A profundidade vem do contraste entre o trilho e o fundo.

## Components

Botão primário preto. Seleção de Dia, Semana e Mês em botão preto, como a navegação do painel. Compromisso em bloco sólido com cantos de 6px e sem contorno. Amostra quadrada de 10px liga uma lista à cor da categoria.

## Do's and Don'ts

- Faça: mantenha o agora visível em toda tela.
- Faça: escreva o nome da categoria ao lado da cor na tela do dia e no compromisso aberto.
- Não faça: mais de três cores além de preto e cinza.
- Não faça: barra colorida na lateral de item de lista.
- Não faça: recurso remoto de fonte ou de script.
