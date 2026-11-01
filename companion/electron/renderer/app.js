// Interface da janela. Recebe estado pronto do processo principal; nÃ£o acessa
// rede, sistema de arquivos nem o token do dispositivo.

const $ = (id) => document.getElementById(id);
const CATEGORY_LABEL = {
  study: 'Estudo',
  project: 'Projeto',
  reading: 'Leitura',
  break: 'Pausa',
  game: 'Jogo',
  other: 'Outra atividade',
};

let state = null;
let busy = false;

function show(id, visible) {
  $(id).classList.toggle('hidden', !visible);
}

function elapsed(since) {
  const start = Date.parse(since);
  if (!Number.isFinite(start)) return 'â€”';
  const total = Math.max(0, Math.floor((Date.now() - start) / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function renderStatus() {
  const status = $('status');
  if (!state.paired) {
    status.textContent = 'desconectado';
    status.className = 'pill off';
    return;
  }
  if (state.paused) {
    status.textContent = 'pausado';
    status.className = 'pill paused';
    return;
  }
  status.textContent = state.detected ? 'observando' : 'ativo';
  status.className = 'pill on';
}

function renderPresence() {
  const active = Boolean(state.detected) && !state.paused;
  $('presence-dot').className = `dot ${active ? 'on' : state.paused ? 'paused' : ''}`;
  $('presence-app').textContent = state.paused
    ? 'PresenÃ§a pausada'
    : state.detected?.label || 'Nenhum aplicativo da lista';
  $('presence-meta').textContent = state.paused
    ? 'Nada estÃ¡ sendo enviado ao Lume.'
    : state.detected
      ? `${CATEGORY_LABEL[state.detected.category] || 'Outra atividade'} Â· ${state.deviceName || 'este computador'}`
      : 'Aguardando um aplicativo autorizado.';
  $('presence-time').textContent = active && state.since ? elapsed(state.since) : 'â€”';
  $('pause').textContent = state.paused ? 'Retomar presenÃ§a' : 'Pausar presenÃ§a';
}

function renderPlan() {
  const plan = state.plan;
  show('plan', Boolean(plan));
  if (!plan) return;
  $('plan-totals').textContent = plan.totals.remaining
    ? `Faltam ${plan.totals.remaining} ${plan.totals.remaining === 1 ? 'aula' : 'aulas'} em ${plan.totals.activeCourses} ${plan.totals.activeCourses === 1 ? 'curso ativo' : 'cursos ativos'}`
    : 'Nada pendente nos cursos em andamento';
  const steps = $('plan-steps');
  steps.replaceChildren();
  for (const step of (plan.steps || []).slice(0, 3)) {
    const item = document.createElement('li');
    const title = document.createElement('strong');
    title.textContent = step.title;
    const meta = document.createElement('small');
    meta.textContent = [step.courseTitle, step.discipline, step.reason?.label].filter(Boolean).join(' Â· ');
    item.append(title, meta);
    steps.append(item);
  }
  const note = $('plan-note');
  note.textContent = plan.note || (plan.steps?.length ? '' : 'Sem passos pendentes.');
  note.classList.toggle('hidden', !note.textContent);
}

function renderError(message) {
  const node = $('error');
  node.textContent = message || '';
  node.classList.toggle('hidden', !message);
}

function discordLine(discord) {
  if (!discord.enabled || discord.status === 'off') return 'Status oculto neste computador.';
  if (!discord.configured || discord.status === 'unconfigured') return 'Informe o Application ID para publicar o status.';
  if (discord.status === 'connected') return 'Curso e aula atuais visíveis no Discord.';
  if (discord.status === 'retrying') return 'Aguardando o Discord neste computador.';
  return 'Conectando ao Discord…';
}

function renderDiscord() {
  const discord = state.discord || { enabled: true, configured: false, status: 'unconfigured' };
  const button = $('discord-toggle');
  button.textContent = discord.enabled ? 'Ocultar do Discord' : 'Mostrar no Discord';
  button.setAttribute('aria-pressed', discord.enabled ? 'true' : 'false');
  $('discord-line').textContent = discordLine(discord);
}

function renderUpdate() {
  const info = state.update || {};
  const status = info.status || 'idle';
  const current = info.currentVersion || '';
  const line = $('update-line');
  const action = $('update-action');
  const note = $('update-note');

  if (status === 'checking') line.textContent = 'Procurando atualizaÃ§Ã£oâ€¦';
  else if (status === 'current') line.textContent = `VersÃ£o ${current} Ã© a mais recente.`;
  else if (status === 'available') line.textContent = `VersÃ£o ${info.latest} disponÃ­vel. VocÃª estÃ¡ na ${current}.`;
  else if (status === 'downloading') line.textContent = `Baixando a versÃ£o ${info.latest}â€¦${info.progress ? ` ${info.progress}%` : ''}`;
  else if (status === 'ready') line.textContent = `Instalador da versÃ£o ${info.latest} pronto para abrir.`;
  else if (status === 'installing') line.textContent = 'Instalador aberto.';
  else if (status === 'error') line.textContent = 'NÃ£o foi possÃ­vel verificar agora.';
  else line.textContent = current ? `VersÃ£o ${current}` : 'VersÃ£o desconhecida';

  const labels = {
    idle: 'Verificar atualizaÃ§Ã£o',
    checking: 'Procurandoâ€¦',
    current: 'Verificar de novo',
    available: 'Baixar e instalar',
    downloading: 'Baixandoâ€¦',
    ready: 'Abrir instalador',
    installing: 'Abrir novamente',
    error: 'Tentar de novo',
  };
  action.textContent = labels[status] || labels.idle;
  action.disabled = busy || status === 'checking' || status === 'downloading';

  const notes = {
    ready: 'O instalador vai abrir. Feche o Lume e conclua. A conta conectada continua valendo.',
    installing: 'Feche o Lume para a instalaÃ§Ã£o concluir e abra de novo depois.',
    error: info.error || '',
    available: 'O arquivo ainda nÃ£o tem assinatura digital: o Windows pode pedir confirmaÃ§Ã£o.',
  };
  note.textContent = notes[status] || '';
  note.classList.toggle('hidden', !note.textContent);
}

function render() {
  if (!state) return;
  $('device').textContent = state.paired
    ? `${state.deviceName || 'este computador'}${state.paused ? ' Â· pausado' : ''}`
    : 'Desconectado';
  renderStatus();
  show('pair', !state.paired);
  show('presence', state.paired);
  show('unpair', state.paired);
  if (state.paired) renderPresence();
  renderPlan();
  renderDiscord();
  renderError(state.error);
  document.querySelectorAll('button').forEach((button) => { button.disabled = busy; });
  renderUpdate();
}

async function run(action, payload) {
  busy = true;
  render();
  try {
    const result = await window.companion.action(action, payload);
    if (result) {
      state = { ...state, ...result };
      render();
    }
    renderError('');
  } catch (error) {
    renderError(String(error?.message || error).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
  } finally {
    busy = false;
    render();
  }
}

$('pair-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const code = $('pair-code').value.trim();
  const name = $('pair-name').value.trim();
  const apiUrl = $('pair-api').value.trim();
  if (!code) { renderError('Informe o cÃ³digo mostrado no Lume.'); return; }
  run('pair', { code, name, apiUrl }).then(() => {
    if (state?.paired) {
      $('pair-code').value = '';
      $('pair-name').value = '';
    }
  });
});

$('pause').addEventListener('click', () => run('toggle-pause'));
$('discord-toggle').addEventListener('click', () => run('toggle-discord'));
$('refresh').addEventListener('click', () => run('refresh'));
$('open-settings').addEventListener('click', () => run('open-settings'));
$('unpair').addEventListener('click', () => {
  if (confirm('Desconectar este computador? A presenÃ§a deixa de ser enviada atÃ© um novo pareamento.')) run('unpair');
});
$('open').addEventListener('click', () => run('open-lume'));
$('update-action').addEventListener('click', () => {
  const status = state?.update?.status || 'idle';
  if (status === 'available') {
    run('update-download').then(() => {
      if (state?.update?.status === 'ready') return run('update-install');
      return null;
    });
    return;
  }
  if (status === 'ready' || status === 'installing') { run('update-install'); return; }
  run('update-check');
});

window.companion.onState((value) => {
  state = value;
  render();
});

setInterval(() => { if (state?.detected && !state.paused) $('presence-time').textContent = elapsed(state.since); }, 1000);

window.companion.action('state').then((value) => { state = value; render(); }).catch(() => renderError('NÃ£o foi possÃ­vel carregar o estado do Companion.'));
