# Lume — aplicativo de desktop

Status: **em desenvolvimento**. O aplicativo é o **próprio Lume em uma janela
de desktop**: conta, biblioteca, plano, amigos, mensagens, ranking e perfil são
os mesmos do site. Em volta dessa janela ele acrescenta o que um site não faz:
bandeja do sistema, presença opcional do aplicativo autorizado em uso, roteiro
visível sem abrir a janela e atualização pelo próprio programa. O agente de
linha de comando continua disponível para diagnóstico. O instalador é publicado
pelo GitHub Actions e ainda não tem assinatura digital (ver seção 8).

**Nome.** Na interface e nos textos de produto ele é "o Lume" ou "o aplicativo
de desktop". "Companion" é só o nome técnico do pacote (`companion/`), das tags
de release (`companion-v*`), dos endpoints (`/api/companion/*`) e do arquivo
de configuração; o arquivo deste documento mantém o nome antigo para não
quebrar links.

**Presença não é o produto.** A presença é um recurso do aplicativo entre
outros. O aplicativo existe para que o Lume inteiro fique à mão enquanto se
estuda; a presença, o roteiro e a bandeja são o que ele faz além do site.

## 1. Por que um aplicativo

- **O Lume completo fora da aba do navegador.** Uma janela própria, que mantém a
  sessão e fica na bandeja em vez de se perder entre abas.
- **O que um site não tem permissão de fazer.** O Discord mostra "jogando X há
  40 minutos" porque é um aplicativo nativo, com permissão para ler processos
  do sistema. O aplicativo do Lume faz o equivalente com uma regra diferente:
  **ler apenas o que a pessoa autorizou**, sem capturar tela, teclado ou
  títulos de janela.
- **O mesmo roteiro do site.** A bandeja e a janela indicam a mesma próxima
  aula que a página Hoje.

O aplicativo não é uma segunda conta nem um segundo produto: não tem banco
local e o que ele mostra vem da mesma API.

### Aplicativo e extensão do navegador

São dois programas diferentes, que se complementam:

| | Aplicativo de desktop | Extensão do navegador |
| --- | --- | --- |
| O que é | O Lume completo numa janela, mais bandeja, presença e atualização | Leitor de curso dentro da página da plataforma (`extension/`) |
| Onde age | No computador (processos autorizados, janela do Lume) | Na aba da plataforma que a pessoa abriu com a conta dela |
| Para que serve | Usar o Lume; saber o que está aberto; roteiro na bandeja | Trazer ao Lume aulas, durações e conclusões de cursos que só existem logados |
| Aciona-se | Fica aberto | Só quando a pessoa clica no ícone |
| Estado | Implementado (instalador sem assinatura) | Protótipo; não está na loja |

O aplicativo não enxerga o que há dentro do navegador: ele não lê título de
janela nem site. **A presença de "estou numa aula do Gran" no navegador não
existe.** A proposta é a extensão relatar essa presença, só para aulas de
cursos que a pessoa importou, com um token de pareamento e permissão opcional
por plataforma, e a mesma regra de nunca gerar XP; isso ainda não foi
implementado nem decidido. Ver [Importação](IMPORTACAO.md).

## 2. O que já existe

| Capacidade | Situação |
| --- | --- |
| Agente de linha de comando (Windows, sem dependências) | Implementado |
| Leitura de processos via `tasklist` | Implementado |
| Allowlist por aplicativo, com nome e categoria | Implementado |
| Pareamento por código de uso único (10 min) | Implementado |
| Token por dispositivo, guardado como hash no servidor | Implementado |
| Presença com expiração (90 s sem batimento) | Implementado |
| Painel no site: conectar, ver presença, desconectar | Implementado |
| Quantas aulas faltam e em quais cursos | Implementado (`/api/companion/study`) |
| Roteiro por prioridade | Implementado no servidor; exibido no comando `plan` e na janela |
| Bandeja do sistema, janela principal com o site e painel de presença (Electron 45) | Implementado; abrir com `npm run companion:app` |
| Rich Presence no Discord | Implementado no processo principal do Electron. Exige Application ID e a arte `lume_logo` no portal do Discord; sem o ID, fica inativo |
| Instalador assinado | Pendente; a atualização pela janela já baixa e abre o instalador |

A página Hoje do site usa o mesmo critério (`nextAction`, derivado de
`studyPlan`), então o programa e o site indicam a mesma próxima aula. A aba
Roteiro do Plano (antiga Missões) lista a próxima aula de cada curso com o
mesmo critério.

## 3. Presença (recurso opcional do aplicativo)

Quando a pessoa autoriza, o aplicativo mostra: **aplicativo**, **categoria**,
**desde quando** e **em qual computador**. Nada além disso.

Exemplo de presença:

```text
Anki · Estudo · há 42 min · PC da Ana
```

Regras:

- A presença expira sozinha; fechar o programa ou desconectar limpa na hora.
- Soa como "aberto", nunca como "estudando de verdade".
- Não entra no histórico, não conclui aula e não gera XP.
- A lista de aplicativos é sua; nada fora dela é enviado.
- Não há leitura de títulos de janela — um PDF aberto não revela o nome do
  arquivo, e um navegador não revela o site. Cursos abertos no navegador só
  poderiam aparecer pela extensão (ver seção 1); hoje não aparecem.

Categorias: `study`, `project`, `reading`, `break`, `game`, `other`. A categoria
`game` existe para presença social honesta ("estou jogando"), nunca para XP.

## 4. Quantas aulas faltam

O Companion consulta a cópia do estado da conta, somente leitura:

```text
Faltam 37 aulas em 3 cursos ativos · 1 pausado · 2 concluídos
```

Por curso:

| Campo | Significado |
| --- | --- |
| `remaining` | Aulas selecionadas ainda não concluídas |
| `total` | Aulas selecionadas na importação |
| `percent` | Progresso dentro da seleção |
| `partial` | A grade importada é parcial — não representa o curso inteiro |
| `next` | Próxima aula |

Grade parcial é rotulada como parcial. O programa nunca diz que um curso
acabou quando só as áreas escolhidas terminaram.

## 5. Roteiro por prioridade

Critério explícito, na ordem:

1. **Continuidade** — material com estudo registrado nos últimos 7 dias.
2. **Primeiro passo** — material sem nenhum progresso.
3. **Perto do fim** — menos aulas restantes.
4. **Ordem da biblioteca** — desempate final.

Pausados e concluídos ficam fora. Cursos de exemplo não entram. Cada passo
mostra o motivo (`Continuidade`, `Primeiro passo`, `Perto do fim`, `Em
andamento`), para a pessoa entender por que aquilo veio primeiro.

Saída do comando `plan`:

```text
Faltam 12 aulas em 2 cursos ativos · 0 pausados · 0 concluídos.
Critério: Prioridade por continuidade recente, primeiro passo, proximidade do fim e ordem da biblioteca.
  1. Aula 2 — Direitos fundamentais — OAB — Gran Cursos · Direito Constitucional (Continuidade)
  2. Instalação do ambiente — Trilha Full-Stack (Primeiro passo)
```

## 6. Janelas e bandeja (implementadas)

O app é o **Lume completo**: a janela principal (1240×820) carrega o próprio
Lume publicado, na mesma origem do navegador. Conta, amigos, perfil, biblioteca e
ranking continuam os mesmos, porque a API é a mesma — o app não tem banco local
nem uma segunda conta.

| Janela | O que mostra |
| --- | --- |
| Principal | O site do Lume inteiro: login, Hoje, Biblioteca, Plano (cronograma, tarefas e roteiro), Amigos (contatos, mensagens e ranking), Perfil (conquistas, Meu caminho e configurações) e a página Instalar aplicativo |
| Presença | Painel local de 400×640: dispositivo, aplicativo em uso, roteiro, pausa, pareamento e versão |

A janela principal abre links externos no navegador, mantém a sessão entre
execuções (cookie do site), fecha para a bandeja em vez de encerrar e mostra uma
página local de "sem conexão" com botão de nova tentativa quando o site não
responde. Ela usa barra de título própria, com a identidade do Lume, e um botão
discreto de atualização no topo, além do botão da janela de presença.

O painel de presença mostra:

| Área | O que mostra |
| --- | --- |
| Cabeçalho | Nome do dispositivo e estado (`observando`, `pausado`, `desconectado`) |
| Agora | Aplicativo detectado, categoria, relógio da sessão e aviso de que não gera XP |
| Roteiro | Aulas restantes, cursos ativos e as três próximas aulas com o motivo da prioridade |
| Ações | Pausar/retomar presença, atualizar roteiro, abrir o Lume, desconectar |
| Versão | Versão instalada, verificar atualização, baixar e abrir o instalador novo |
| Discord | Curso e aula do roteiro no perfil do Discord, ligado por padrão, com interruptor no painel e na bandeja |
| Pareamento | Código, nome do computador e endereço da API (avançado) |

A bandeja tem ícones próprios para ativo, pausado e desconectado, menu com o
estado atual, a próxima aula e o atalho para sair. Fechar a janela não encerra o
programa: ele continua na bandeja até "Sair".

**Atualização.** A janela de presença mostra a versão instalada e um botão que
consulta a última release `companion-v*` na API pública do GitHub
(`companion/update.mjs`). Se houver versão nova, o mesmo botão baixa o
`Lume-setup.exe` para uma pasta temporária, com progresso, e abre o instalador.
A configuração em `%APPDATA%\Lume\companion.json` é preservada, então o
computador continua pareado depois de atualizar; não é preciso reinstalar nem
gerar outro código. Nada é baixado sem clique, só endereços `https` do GitHub
são aceitos e o programa avisa que o instalador ainda não é assinado.

O que ainda falta nessa camada:

| Recurso | Descrição |
| --- | --- |
| HUD discreto | Sempre no topo, por escolha, com tempo e próxima aula |
| Notificações | Lembrete gentil de pausa; nunca cobrança |
| Sessão no programa | Iniciar, pausar e encerrar a sessão declarada do site |
| Retomada direta | Abrir a próxima aula no navegador pelo link da fonte |
| Biblioteca local | Lista de cursos sem abrir o site |
| Offline | Fila local de presença, sincronizada depois |
| Início com o Windows | Opcional, explícito e reversível |
| Assinatura do instalador | O pacote NSIS já é publicado; falta assinar o executável |

Regras para todos eles: presença e roteiro nunca geram XP; compartilhamento é
opt-in; pausa não é punida; nada de vigilância.

## 7. Arquitetura

```text
[Electron: janela principal]  →  [site publicado: conta, biblioteca, amigos, perfil]
[Electron: painel + bandeja]  ─┐
[companion/agent.mjs (CLI)]   ─┴→ [companion/core.mjs]
                                      tasklist → allowlist → presença
                                      │  Bearer <token do dispositivo>
                                      ▼
                              [API: /api/companion/*]
                                      │
                                      ▼
                              [estado da conta]  cursos, aulas, progresso, sessões
```

- A janela principal carrega o site publicado na mesma origem. Não existe banco
  local nem segunda conta: o que a pessoa vê no app é o mesmo Lume do navegador.
- O painel de presença não tem acesso a Node nem ao token: fala com o processo
  principal por IPC com `contextIsolation` e `sandbox` ligados.
- O Rich Presence fala só com o cliente do Discord no computador, a partir do
  processo principal. O painel apenas liga ou desliga; não vê o token do
  dispositivo nem o Application ID.
- A janela principal também roda com `contextIsolation`, `sandbox` e sem Node;
  links externos vão para o navegador.
- O token é criado no pareamento (código de 8 caracteres, uso único, 10 min).
- O token só pode relatar presença e **ler** o roteiro; não altera estado.
- O servidor guarda apenas o hash do token.
- Revogar no site invalida o token imediatamente.

## 8. Roadmap

| Fase | Entrega | Estado |
| --- | --- | --- |
| 1 | Agente CLI, pareamento, presença, painel no site | Feito |
| 2 | Roteiro e contagem de aulas no agente | Feito |
| 3 | App Electron: bandeja, painel e **janela com o Lume completo** | Feito |
| 4 | Instalador Windows via GitHub Actions | Feito; assinatura é opcional |
| 5 | Início com o Windows e auto-update | Atualização pelo botão da janela (manual); início com o Windows pendente |
| 6 | Sessão declarada dentro do programa + retomada | Substituído pela janela com o site: a sessão já funciona no app |
| 7 | Presença social entre amigos (opt-in) | Amigos e mensagens diretas já existem no site; presença social não |

A publicação é feita por tag (`companion-v<versão>`), que precisa bater com
`companion/package.json`; a última release publicada é a `companion-v0.5.0`, e o
pacote local já está na 0.5.1. O workflow gera o instalador NSIS, sem precisar de
máquina Windows local. Detalhes, secrets de assinatura e solução de problemas em
[Publicação e CI](RELEASE.md).

### Como abrir agora

O caminho normal é pelo site: **Instalar aplicativo**, na barra lateral,
abaixo do menu e acima do perfil. O botão baixa o instalador da última release
(`Lume-setup.exe`) e mostra o aviso de que ele ainda não é assinado.
A mesma tela gera o código de conexão — o programa não pede mais que a pessoa
procure em Configurações.

Para instalar manualmente, use a página de Releases do repositório.

Dentro da pasta do projeto (desenvolvimento):

```sh
npm install --prefix companion   # instala o Electron (uma vez)
npm run companion:app            # abre a bandeja e a janela
```

De qualquer pasta, ou com dois cliques:

```text
D:\tabletop\lume.cmd
```

O iniciador entra sozinho na pasta certa e confere se o Electron está instalado.
Use `D:\tabletop\lume.cmd --debug` para abrir com o console visível e
ver mensagens de erro.

Quem baixa pelo GitHub usa o instalador publicado em **Releases** (gerado pelo
workflow `Companion release`); não precisa de Node nem do projeto.

> `npm run companion:app` só funciona dentro de `D:\tabletop`. Rodar em
> `C:\Users\Ana` produz `npm error ENOENT ... C:\Users\Ana\package.json` — não é
> falta de arquivo do projeto, é a pasta errada.

Ou, sem janela: `npm run companion` (agente de terminal).

## 9. Limitações atuais

- Windows apenas; sem suporte a Linux/macOS.
- A janela e a bandeja foram verificadas em Chromium (mesma engine do Electron) e
  por checagem de sintaxe, mas **não foi possível abrir o app Electron na sessão
  automatizada de desenvolvimento** (sem desktop interativo). A validação final
  do ícone da bandeja é manual: `npm run companion:app`.
- Instalador publicado pelo CI, sem assinatura de código: o Windows pode avisar
  na primeira execução.
- Sem leitura de progresso automático das plataformas: a conclusão continua
  manual e identificada.
- O status no Discord mostra o curso e a aula do roteiro (ou "Estudando no Lume"). O aplicativo não lê a atividade de outros programas. Sem Application ID configurado, o status fica oculto.
- Sem presença de cursos abertos no navegador (depende da extensão, ainda não implementada).
- Presença não vira tempo elegível de XP; a política exige validação no servidor.
- Amigos, mensagens diretas e ranking de amigos existem no site; presença social e feed continuam pendentes; grupos, comunidades e canais estão fora do escopo desta etapa.
