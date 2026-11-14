# Lume — programa de desktop

Este README cobre o pacote `companion/`. As regras de negócio do produto estão em
[docs/REGRAS_DE_NEGOCIO.md](../docs/REGRAS_DE_NEGOCIO.md); a publicação do instalador está em
[docs/RELEASE.md](../docs/RELEASE.md).

O app é o **Lume completo em uma janela**: carrega o site publicado na mesma origem
(mesma conta, mesmos amigos e perfil), mantém a bandeja com presença local e um
painel de presença, e verifica/baixa atualizações. O agente de linha de comando
continua disponível para diagnóstico.

## O que ele faz

- Abre o site do Lume em uma janela própria (1240×820), com barra de título do
  Lume e links externos enviados ao navegador.
- Fecha para a bandeja em vez de encerrar; a bandeja mostra estado, próxima aula
  e o atalho para sair.
- Painel de presença (400×640): dispositivo, aplicativo detectado, roteiro por
  prioridade, pausa, pareamento, versão, atualização e o interruptor do Discord.
- Lê a lista de processos do sistema (`tasklist` no Windows; `ps` ou
  `/proc/<pid>/comm` no Linux) e compara com a **allowlist** que você escolhe:
  processo → nome exibido → categoria (`study`, `project`, `reading`, `break`,
  `game`, `other`).
- Envia ao Lume o aplicativo encontrado, a categoria e desde quando ele está
  aberto. Sem batimento por 90 segundos, a presença expira sozinha.
- Mostra quantas aulas faltam por curso e o roteiro por prioridade
  (continuidade, primeiro passo, proximidade do fim, ordem da biblioteca).
- Botão de atualização consulta a última release `companion-v*` no GitHub, baixa
  o instalador compatível (`Lume-setup.exe` no Windows; `Lume.AppImage` ou
  `Lume.deb` no Linux) com progresso e abre o arquivo/pasta. A configuração em
  `%APPDATA%\Lume\companion.json` (Windows) ou `~/.config/Lume/companion.json`
  (Linux) é preservada.

## O que ele não faz

- Não lê título de janela, conteúdo de tela, teclado, arquivos ou histórico.
- Não envia nomes de aplicativos fora da sua lista.
- Não conta tempo como estudo, não conclui aulas e **não gera XP**.
- Não tem banco local nem uma segunda conta: o app usa a API do site.
- Não funciona no macOS nesta versão.
- Comunidades, servidores, canais e grupos estão fora do escopo desta etapa.

## Desenvolvimento

Node **22.23.4 ou superior** (testado com 24), Windows ou Linux x64. O Electron
tem dependências próprias, com lockfile separado:

```sh
npm install --prefix companion    # Electron e electron-builder, uma vez
npm run companion:app             # bandeja + janela
npm run companion                 # agente de terminal
```

Comandos do pacote, a partir de `companion/`:

```sh
npm start            # igual a npm run companion:app
npm run smoke        # abre a janela escondida, grava smoke-result.json e encerra
npm run pack         # electron-builder --win dir (release/win-unpacked)
npm run dist         # instalador NSIS (release/Lume-setup.exe)
npm run pack:linux   # electron-builder --linux dir (release/linux-unpacked)
npm run dist:linux   # pacotes Linux (release/Lume.AppImage e release/Lume.deb)
```

Fora da pasta do projeto, use o iniciador: `D:\tabletop\lume.cmd`
(`--debug` abre com o console visível).

## Conectar

1. No Lume, entre na conta e abra **Instalar aplicativo** na barra lateral.
2. Gere o código de conexão de 8 caracteres (vale 10 minutos, uso único).
3. No computador, dentro do projeto:

```sh
npm run companion:pair -- ABCD-EFGH --name "PC da Ana"
```

No servidor local, informe a API:

```sh
npm run companion:pair -- ABCD-EFGH --name "PC da Ana" --api http://127.0.0.1:4173
```

4. Deixe o agente rodando (`npm run companion`) ou use a janela/bandeja.

## Comandos do agente

```sh
node companion/agent.mjs status                 # vê o que seria detectado, sem enviar
node companion/agent.mjs plan                   # aulas restantes e roteiro por prioridade
node companion/agent.mjs allow anki --label "Anki" --category study
node companion/agent.mjs allowlist
node companion/agent.mjs remove anki
node companion/agent.mjs run --once --dry-run   # testa a detecção sem rede
node companion/agent.mjs pause | resume
node companion/agent.mjs unpair
```

## Configuração

Fica em `%APPDATA%\Lume\companion.json` (Windows) ou `~/.config/Lume/companion.json` (Linux, fora do repositório; arquivos antigos em `~/.lume/companion.json` continuam reconhecidos):

```json
{
  "apiUrl": "https://lumeacademy.site",
  "token": "…",
  "deviceName": "PC da Ana",
  "intervalSeconds": 5,
  "paused": false,
  "discordPresence": true,
  "discordClientId": "COLOQUE_O_APPLICATION_ID",
  "discordPublicUrl": "",
  "allowlist": [
    { "process": "anki", "label": "Anki", "category": "study" },
    { "process": "code", "label": "VS Code", "category": "project" }
  ]
}
```

O token é o acesso deste computador. Ele só pode **relatar presença** e ler o
roteiro — não lê o estado da conta, não altera cursos e não recebe XP. Para
revogar, use **Desconectar** no painel do Lume; o token deixa de valer
imediatamente.

`discordPresence` liga o status no Discord (padrão: ligado). `discordClientId`
e `discordPublicUrl` estão descritos na seção Discord.

## Discord

O aplicativo pode mostrar no Discord o curso e a aula atuais do roteiro. O site
não faz isso: o Rich Presence só existe num programa local, falando com o
cliente do Discord pelo canal IPC. A função fica no processo principal do
Electron.

- Ligado por padrão. No painel, **Ocultar do Discord** desliga; a escolha fica
  em `discordPresence`. A bandeja tem o mesmo interruptor.
- Com roteiro, a linha de detalhes é o nome do curso e o estado é o nome da
  aula. Sem roteiro, o texto é "Estudando no Lume".
- Quando o curso tem total conhecido, o Discord mostra o contador "(12 de 40)"
  ao lado da aula: aulas já concluídas + 1, sobre o total do curso. É uma
  referência de avanço, não prova de estudo.
- Com a janela do Lume aberta, o status acompanha o que você estuda: aula aberta ("Estudando Falência" / "Aula 9 · título"), PDF aberto ("Lendo …" / "Página 12 de 300") e sessão de foco ("Em foco · curso", com o relógio da sessão; em pausa mostra "12 min focados"). A página envia só esses nomes, a cada 20 s; se parar de enviar (janela fechada, página travada), o status volta ao roteiro. Abrir a tela não conta como estudo: sem aula, PDF ou foco abertos, vale o roteiro. Não gera XP.
- **Pausar a presença** troca o status para "Em pausa", sem relógio, curso ou
  contador; ao retomar, o relógio recomeça.
- A imagem grande usa a chave de arte `lume_logo`. O tempo decorrido começa
  quando a atividade atual começa (o aplicativo autorizado, se houver, ou o
  momento em que aquele curso e aquela aula passaram a ser o status).
- Um botão, **Abrir o Lume**, aponta para o site público. No seu próprio perfil
  o Discord não mostra os botões; outras pessoas veem.

### Criar o aplicativo no Discord

1. Abra o [Portal do desenvolvedor](https://discord.com/developers/applications)
   e crie um aplicativo (por exemplo, "Lume").
2. Copie o **Application ID**.
3. Em **Rich Presence → Art Assets**, envie o logo do Lume com o nome
   **`lume_logo`** (minúsculas, sem espaço). O arquivo com a estrela dourada da
   identidade Norte (1024×1024) está em `companion/assets/discord-lume_logo.png`,
   gerado de `public/favicon.svg`. Para trocar a imagem já enviada, apague o
   asset antigo, envie este com o mesmo nome e salve; o Discord pode levar
   alguns minutos (ou reiniciar o cliente) para parar de mostrar a versão em cache.
4. O Application ID do Lume já vem no build (`DEFAULT_DISCORD_CLIENT_ID` em
   `discord-presence.mjs`); não é segredo. Para usar outro aplicativo, coloque o
   ID em `%APPDATA%\Lume\companion.json`, no lugar de `COLOQUE_O_APPLICATION_ID`:

```json
"discordClientId": "123456789012345678"
```

A variável de ambiente `LUME_DISCORD_CLIENT_ID` também serve e tem prioridade
sobre o arquivo. Enquanto o valor estiver vazio ou for o marcador
`COLOQUE_O_APPLICATION_ID`, o aplicativo não conecta, não quebra e não repete
erro no log.

O botão usa `discordPublicUrl` ou a variável `LUME_DISCORD_PUBLIC_URL`, desde
que seja `https`. Sem isso, o endereço é
`https://lumeacademy.site`.

Se o Discord estiver fechado ou a conexão cair, o status some junto com a
conexão e o Lume tenta de novo em silêncio, com espera crescente (5s, 10s,
20s…, no máximo 5 min). O status só é reenviado quando o texto muda, no máximo
uma vez a cada 15 segundos. A atividade também é removida ao ocultar o status
e ao sair do aplicativo.

## Segurança e privacidade

- Cada computador tem um token próprio, guardado apenas como hash no servidor.
- O código de conexão é de uso único, curto e expira em 10 minutos.
- A allowlist é sua: nada é enviado sem você adicionar o processo.
- Presença é temporária e privada; o painel não lê tela nem títulos de janela.
- "Aplicativo aberto" não é estudo comprovado e não alimenta XP nem ranking.

## Release e limitações

- O instalador é gerado pelo GitHub Actions a partir de uma tag
  `companion-v<versão>` que precisa bater com `companion/package.json`.
- Sem assinatura de código: o Windows pode avisar na primeira execução.
- Atualização é manual (botão na janela), não automática.
- Windows x64 e Linux x64 (`.AppImage` e `.deb`); sem suporte a macOS.
- No Linux, ambientes sem suporte a bandeja (ex.: GNOME sem extensão AppIndicator) mantêm o uso normal pela janela e o fechamento encerra o processo em vez de ocultar para a bandeja.
- Sem leitura de progresso automático das plataformas: a conclusão continua
  manual e identificada.
- O status no Discord mostra curso e aula do roteiro; o Lume não lê a
  atividade de outros programas nem o que a pessoa faz dentro do Discord.
