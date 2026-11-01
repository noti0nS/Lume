# Lume — instruções para agentes e colaboradores

Antes de propor ou alterar comportamento do produto, leia nesta ordem:

1. [Visão e requisitos do produto](docs/PRODUTO.md).
2. [Gamificação e conquistas](docs/GAMIFICACAO.md).
3. [Estado atual e plano de evolução](docs/CONTINUIDADE.md) — matriz do que existe × planejado; atualize-a ao implementar.
4. [Importação de cursos por link](docs/IMPORTACAO.md), antes de mexer em fontes, extração ou progresso de aulas importadas.
5. [Lume](docs/COMPANHEIRO.md), antes de mexer no aplicativo de desktop (o Lume completo numa janela), na presença ou no roteiro por prioridade.
6. [Diagnóstico e plano de evolução](docs/EVOLUCAO.md): cargos, desbloqueios, integrações, navegação e tom de voz propostos, com o que cada etapa já entregou.
7. [O que falta implementar](docs/IMPLEMENTACAO.md): lacunas principais, mapa do que existe, configuração de produção e decisões pendentes. Comece por aqui para saber o que ainda não funciona.

Esses documentos descrevem o destino do Lume. O código atual é um protótipo e contém regras antigas que não representam mais o produto desejado. Prevalência: instrução explícita da pessoa responsável > `docs/` > código e testes antigos. Mantenha a documentação coerente com novas decisões.

## Comandos

Windows com ExecutionPolicy restrita: `npm.ps1`/`npx.ps1` falham; use `npm.cmd`/`npx.cmd` ou `node` direto.

```sh
npm run dev          # Astro em 4321 + API Node em 4173; LUME_API_PORT troca a API e o proxy acompanha
npm start            # build + serve dist/ em 4173 (PORT ajusta)
npm run preview      # só serve o dist/ existente
npm run build        # astro build + scripts/headers.mjs (gera dist/_headers com CSP)
npm test             # node --test nos arquivos listados em package.json
node --test auth.test.js
node --test --test-name-pattern="redefini" session.test.js
npm run test:e2e     # Playwright; exige dist/ e sobe o próprio servidor na 4187
npx playwright test tests/e2e/session.spec.js --project=desktop
```

Não há lint, typecheck, formatter nem TypeScript configurados — não invente `npm run lint`/`tsc`. O projeto é JavaScript puro (`.js`/`.jsx`), `"type": "module"`, Node >= 22.23.4 (usa `node:sqlite`).

No CI, `PLAYWRIGHT_CHANNEL=bundled` força o Chromium baixado; localmente o padrão é o Chrome instalado.

## Arquitetura que não é óbvia pelos nomes

- **SPA em uma única página Astro.** `src/pages/index.astro` monta `<App client:only="react" />` e define o service worker. As rotas são hashes resolvidos em React (`#hoje`, `#biblioteca`, `#plano`, `#aplicativo`, `#amigos?convite=`, `#perfil?id=`) — criar tela é componente + hash, não arquivo em `src/pages/`. O menu tem cinco destinos; as telas secundárias são abas de seção definidas em `src/components/SectionTabs.jsx` (uma tela nova entra lá, não no menu). `#missoes` é alias de `#roteiro`. `src/components/App.jsx` resolve as rotas; o estado do cliente passa por `src/hooks/useLume.js` e as chamadas HTTP por `src/lib/api.js`. Estilo global em `public/lume.css`.
- **Regras de domínio ficam em `public/*.js`** (`domain.js`, `import-domain.js`, `session-domain.js`, `study-plan.js`, `companion-domain.js`, `profile-domain.js`, `tasks-domain.js`, `slides-domain.js`, `backup-domain.js`, `merge-domain.js`, `xp-policy.js`, `schedule-domain.js` — cronograma derivado de `state.plan` e do progresso). O React (`src/`) e o Node as importam do mesmo arquivo; não duplique regra em `src/lib`.
- **A API existe duas vezes com o mesmo contrato:** `server.js` (Node + `node:sqlite`) e `worker.js` (Cloudflare + D1). Toda mudança de endpoint precisa dos dois. Módulos compartilhados: `auth.js`, `import-server.js`, `companion.js`, `friends.js`, `xp.js` (livro `xp_events` e ranking), `state.js` (estado com revisão otimista), `messages.js`, `collaboration.js`, `github.js` (leitura pública de repositórios, sem token), `email.js` (Resend; sem configuração, o link de redefinição só vai para o log), `media.js` (avatar/header em R2 no Worker via `env.MEDIA`, `data/media/` no Node) e `public/*-domain.js`. Regra nova entra num desses módulos, nunca só num dos dois servidores.
- **XP validado no servidor:** os valores vigentes ficam em `public/xp-policy.js` (`XP_VALUES`, `LEVEL_XP`, blocos de tempo, teto diário) e `xp.js` revalida cada evento a partir do estado sincronizado, com chave de idempotência. O saldo legado (preparação, etapa, tarefa de prova) continua separado, fora do nível novo e do ranking.
- **`server.js` aplica todos os `migrations/*.sql` no boot**, em ordem alfabética; para D1 é `npx wrangler d1 migrations apply lume --remote`. Nunca edite migração já aplicada — crie o próximo número.
- **O servidor lê `dist/` e o CSP uma única vez ao iniciar**; depois de `npm run build`, reinicie `server.js` para servir a versão nova.
- **Estado:** `localStorage`, chave `lume.prototype.v1`, com cópia por conta em `/api/state`. A rota usa revisão otimista: se outro dispositivo salvou antes, o servidor devolve o estado atual e o cliente mescla (`public/merge-domain.js`) antes de reenviar. O documento de estado não altera `xp_events`; o navegador não deve se tornar autoridade de placar.
- **Cores são tokens com função** no topo de `public/lume.css`, por paleta (`html[data-palette="moderno"|"variante2"]`, exibidas como Azul e Roxo) e por tema (`data-theme`): `--action` botão principal, `--lume` destaque e navegação, `--mint` progresso, `--success`, `--reward` XP/sessão em âmbar, `--warning`, `--danger`, `--xp-from`/`--xp-to` para a barra de XP. Não use cor fixa em componentes; misture tokens com `color-mix`. `--logo-bg` e as cores do SVG em `Logo` (`ui.jsx`) não mudam com a paleta: o logo é preservado por decisão da responsável. Ao trocar `lume.css`, atualize o `?v=` em `index.astro`.
- **CSP é hash exato** do `<script>`/`<style>` inline que o Astro emite em `dist/index.html` (`scripts/headers.mjs`). `script-src` não tem `'unsafe-inline'`: script inline injetado em runtime é bloqueado. `style-src-attr 'unsafe-inline'` libera só atributos `style`.
- **Service worker (`public/sw.js`)** usa stale-while-revalidate em assets da mesma origem (menos navegação e `/api/*`): quem já visitou vê a versão em cache uma vez e a atualização só aparece na visita seguinte. Ao alterar CSS/imagens locais, teste com service worker limpo.

## Armadilhas de configuração

- Nomes de variável diferem entre local e Worker: local usa `LUME_SHOW_RESET_LINK`, produção usa `SHOW_RESET_LINK` (definido em `wrangler.jsonc` como `"false"`).
- IA de organização é opcional e só no servidor: `LUME_AI_API_KEY` (fallback `OPENAI_API_KEY`), `LUME_AI_BASE_URL`, `LUME_AI_MODEL`. Sem chave, o organizador determinístico responde. Nunca exponha a chave no frontend nem em arquivos versionados.
- `ATTEMPT_LIMIT` é 10 fixo no Worker e ajustável no Node por `LUME_ATTEMPT_LIMIT`; os e2e usam 200.
- `BCRYPT_ROUNDS=6` no Worker é um compromisso com o limite de 10 ms de CPU do Workers Free e fica abaixo do mínimo 10 da OWASP. Não aumente sem medir (`node scripts/benchmark-auth.mjs 6`); a medição em produção continua pendente.
- Senhas novas: bcrypt até 72 bytes UTF-8, sem truncamento. Hashes PBKDF2 legados são preservados e migram só na redefinição de senha.
- `data/` é local e ignorado no Git (`data/lume.db` guarda as contas); não apague nem versione. Os e2e usam `data/e2e-<timestamp>`.

## Aplicativo de desktop (pacote `companion/`)

O aplicativo de desktop **é o Lume completo numa janela Electron**, com bandeja, presença opcional e atualização; presença não é o propósito dele. "Companion" é só o nome técnico (pasta, tags, endpoints). Em textos de produto, chame de "Lume" ou "aplicativo de desktop". Pacote npm separado em `companion/` (Electron + electron-builder, lockfile próprio): `npm install --prefix companion` uma vez; `npm run companion:app` abre a janela/bandeja e `npm run companion` roda o agente de terminal. `lume.cmd` na raiz é o iniciador. Configuração do usuário em `%APPDATA%\Lume\companion.json`, fora do repositório. `npm test` inclui `companion/update.test.js`; o CI também roda `node --check` nos arquivos do Companion. Release: suba `companion/package.json` e crie a tag `companion-v<versão>` — se não bater, o workflow falha. Detalhes em [Publicação e CI](docs/RELEASE.md); o que falta implementar está em [Funcionalidades pendentes](docs/IMPLEMENTACAO.md).

## Extensão do navegador (`extension/`)

Extensão MV3 sem build: leitor de curso que o usuário aciona na página da plataforma (`activeTab`). `capture.js` é script clássico (sem `import`) e devolve o formato de `normalizePayload` com `extraction.kind: 'extension-capture'` e `completionSource: 'lesson-flags'`; o Lume recebe por `postMessage` (`src/lib/extension.js`, ouvinte em `App.jsx`) e abre a revisão do `ImportCourse`. Não há endpoint novo. No Gran, `capture.js` pede a grade às rotas JSON que a própria página usa (`readGranApi`, só `GET`; cada aula do Gran vira uma aula do Lume) e volta ao DOM se a API falhar. Conclusões lidas na primeira importação são histórico sem XP; só leituras posteriores, confirmadas na revisão, viram `origin: 'integration'` (`observedCompletionIds` em `applyCourseImport`). Testes em `tests/e2e/capture.spec.js` (páginas de exemplo, não reais). Instalação e limites em [extension/LEIAME.md](extension/LEIAME.md). Em scripts Python de edição, não escreva a barra invertida dupla seguida de b em strings comuns: vira backspace.

## Publicação

`npx wrangler deploy` executa `npm run build` antes e envia `dist/` (Worker + D1). Site de referência: <https://lume.lume-prototype.workers.dev>. Publicar não é conclusão de tarefa: não faça deploy, migração remota ou release sem pedido explícito.

## Contexto obrigatório do produto

- Lume é uma plataforma social de estudos: biblioteca, continuidade de materiais, amigos, mensagens diretas, compartilhamento de aprendizados, colaboração, conquistas e placares de estudo.
- Comunidades, servidores, canais e grupos estão fora do escopo desta etapa. O social se limita a amigos, mensagens diretas entre amizades aceitas e colaboração em projetos; não reintroduza grupos por causa de documentação antiga.
- Cadastro e login com e-mail e senha são requisitos do Lume, assim como recuperação de acesso e saída da conta. A prévia local é temporária; não descreva como decisão de que o produto não terá login ou senha.
- A gamificação deve reconhecer avanço real: estudo efetivo, aula concluída, leitura concluída, curso concluído e entrega de projeto. Não premiar cliques ou movimentação na interface.
- Abrir uma janela, entrar no site, cadastrar um material, preparar a mesa, abrir uma aula, conectar uma conta, pausar ou enviar mensagens não gera XP.
- Apoios para começar e dividir uma tarefa continuam úteis, mas não são automaticamente eventos de recompensa. Não confundir preparação com conclusão de estudo.
- Exceção aprovada para a lista de tarefas de prova: criar, editar ou organizar tarefa não gera XP; concluir uma tarefa de estudo definida concede XP uma vez. O valor em execução é 10 XP e ainda é cálculo legado do navegador, não a política validada no servidor.
- A inclusão de pessoas neurodivergentes é central. Personalização, conforto visual e pausas sem punição devem conviver com uma gamificação substancial e uma experiência social opcional.
- Não reduza o produto a um organizador individual de microtarefas, nem retire amigos ou placares por presumir que competição nunca pode ser inclusiva.
- O ranking é um recurso central obrigatório, com classificações por nível acumulado, cursos distintos concluídos e empenho no período. O recorte inicial é de amigos; não há ranking de grupos nesta etapa. Não o substitua apenas por um placar semanal de XP. Participação configurável não torna o desenvolvimento do ranking dispensável.
- Nenhum registro de atividade deve ser descrito como prova de compreensão, inteligência ou benefício clínico.

## Regras para implementar

- Preserve os dados existentes. A migração dos eventos antigos exige tratamento explícito; não apague progresso nem converta preparações antigas em aulas concluídas. O modelo legado em execução (5 XP por preparação, 10 XP por etapa, 10 XP por tarefa de prova, nível a cada 100 XP) não é a nova política e não pode alimentar ranking compartilhado.
- Separe recursos implementados, simulações locais e funcionalidades planejadas. A prévia sem conta e uma simulação de login no navegador não são autenticação. A API local já valida credenciais e emite sessão; isso não comprova publicação nem verificação do mesmo fluxo em produção. A sincronização de uma cópia do estado não equivale à validação de XP no servidor.
- Integrações devem declarar suas capacidades. Não prometa rastreamento automático de qualquer URL, videoaula, PDF, artigo ou repositório.
- Não coloque credenciais de integrações no frontend, em arquivos versionados ou em saídas de ferramentas. Não publique o conteúdo de repositórios privados por padrão.
- A atribuição de XP da versão com contas deve ser validada no servidor, com eventos identificáveis e proteção contra repetição. O navegador não deve ser a autoridade de um placar compartilhado.
- A lista de tarefas de prova vive em `public/tasks-domain.js`; o XP de conclusão é derivado de `state.tasks` e reabrir a tarefa retira o XP até concluir de novo, sem acumular. Ao mexer nessa regra, atualize testes e `docs/GAMIFICACAO.md`.
- Os valores iniciais de balanceamento estão em `docs/GAMIFICACAO.md`. Não espalhe valores contraditórios entre telas e regras de domínio.
- Ao mudar uma regra de produto, atualize os documentos afetados e os testes relevantes. Testes do protótipo não são justificativa para conservar uma regra já substituída.
- Ao receber tarefa só de documentação, documente as divergências; não aproveite para migrar dados, ativar serviços, alterar a pontuação ou publicar mudanças funcionais.
- Textos de interface, documentação e comentários: português do Brasil.

## Verificação e entrega

`npm test` para regras de domínio/autenticação; `npm run build` para validar a aplicação; `npm run test:e2e` para fluxos de interface afetados (rode o build antes, porque o Playwright serve `dist/`). O script `test` lista os arquivos um a um em `package.json`: ao criar `*.test.js`, inclua-o lá, senão ele não roda no CI. Os e2e rodam com 1 worker (`fullyParallel: false`) porque compartilham o SQLite — não paralelize. A análise de link no e2e é interceptada por rota (simulação); extração real de plataformas não é exercitada. Mudanças apenas em documentação exigem revisão de coerência e links, sem repetir testes de código inalterado. Por decisão explícita da responsável, a interface não oferece modo essencial nem tratamento de movimento reduzido; os campos antigos permanecem apenas para compatibilidade dos dados.

Na entrega, informe o que mudou, o que foi verificado e o que ainda não está implementado. Não chame um recurso de concluído com base apenas em sua aparência.

## Cursor Cloud specific instructions

- A imagem já traz Node 22.23.4+ (exigido por `node:sqlite`) e Google Chrome. `npm ci` na raiz prepara o site. O Playwright usa o Chrome instalado, salvo quando `PLAYWRIGHT_CHANNEL=bundled` (é o que o CI faz, e aí precisa de `npx playwright install chromium`).
- `npm run dev` sobe o Astro na porta 4321 e a API em `127.0.0.1:4173`. Não há segredo obrigatório: Resend e `LUME_AI_API_KEY` são opcionais e, sem eles, o link de redefinição vai para o log e o organizador determinístico responde.
- O aplicativo de desktop fica em `companion/` com lockfile próprio (`npm install --prefix companion`). Ele não entra no `npm ci` da raiz.
