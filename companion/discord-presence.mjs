// Presença no Discord — lógica pura.
//
// Monta o status a partir do roteiro, decide quando reenviar e quanto esperar
// para tentar de novo. O canal IPC com o cliente do Discord fica em
// discord-client.mjs e só roda no processo principal do Electron.

export const DISCORD_ASSET_KEY = 'lume_logo';
export const DISCORD_FALLBACK_DETAILS = 'Estudando no Lume';
export const DISCORD_PAUSED_DETAILS = 'Em pausa';
export const DISCORD_BUTTON_LABEL = 'Abrir o Lume';
export const DISCORD_LARGE_IMAGE_TEXT = 'Lume';
export const DISCORD_CLIENT_ID_PLACEHOLDER = 'COLOQUE_O_APPLICATION_ID';
// Application ID do Lume no Discord. É público (não é segredo) e vai no build,
// para a presença funcionar sem configuração; ambiente e companion.json o sobrepõem.
export const DEFAULT_DISCORD_CLIENT_ID = '1566316458340909077';
export const PUBLIC_SITE_URL = 'https://lumeacademy.site';
export const PRESENCE_UPDATE_INTERVAL_MS = 15_000;
export const PRESENCE_COALESCE_MS = 400;
export const RETRY_BASE_MS = 5_000;
export const RETRY_MAX_MS = 5 * 60_000;
export const DISCORD_TEXT_MAX = 128;
const BUTTON_LABEL_MAX = 32;
const URL_MAX = 512;
const FOCUS_DRIFT_MS = 5_000;

export function clipDiscordText(value, max = DISCORD_TEXT_MAX) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (text.length < 2) return '';
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

export function isUsableClientId(value) {
  const text = String(value ?? '').trim();
  if (!text || text === DISCORD_CLIENT_ID_PLACEHOLDER) return false;
  return /^\d{17,20}$/.test(text);
}

// Só https. Um endereço local faria o Discord recusar a atividade inteira.
export function normalizeHttpUrl(value) {
  const text = String(value ?? '').trim();
  if (!text || text.length > URL_MAX) return '';
  let url;
  try { url = new URL(text); } catch { return ''; }
  if (url.protocol !== 'https:') return '';
  if (url.username || url.password) return '';
  return text;
}

export function discordFieldsFrom(value = {}) {
  return {
    discordPresence: value.discordPresence !== false,
    discordClientId: typeof value.discordClientId === 'string' ? value.discordClientId.trim() : '',
    discordPublicUrl: typeof value.discordPublicUrl === 'string' ? value.discordPublicUrl.trim().replace(/^https:\/\/lume\.lume-prototype\.workers\.dev(?=\/|$)/, PUBLIC_SITE_URL) : '',
  };
}

export function resolveDiscordSettings(config = {}, env = {}) {
  const fields = discordFieldsFrom(config);
  const fromEnv = typeof env.LUME_DISCORD_CLIENT_ID === 'string' ? env.LUME_DISCORD_CLIENT_ID.trim() : '';
  const clientId = isUsableClientId(fromEnv)
    ? fromEnv
    : isUsableClientId(fields.discordClientId) ? fields.discordClientId : DEFAULT_DISCORD_CLIENT_ID;
  const publicUrl = normalizeHttpUrl(env.LUME_DISCORD_PUBLIC_URL)
    || normalizeHttpUrl(fields.discordPublicUrl)
    || PUBLIC_SITE_URL;
  return {
    enabled: fields.discordPresence,
    clientId,
    configured: Boolean(clientId),
    publicUrl,
    assetKey: DISCORD_ASSET_KEY,
  };
}

export function toTimestamp(value) {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : 0;
  }
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.round(value);
  if (typeof value === 'string' && value) {
    const time = Date.parse(value);
    return Number.isFinite(time) ? time : 0;
  }
  return 0;
}

export function currentLesson(plan) {
  const step = plan && Array.isArray(plan.steps) ? plan.steps[0] : null;
  if (!step || typeof step !== 'object') return null;
  const course = clipDiscordText(step.courseTitle);
  const lesson = clipDiscordText(step.title);
  if (!course && !lesson) return null;
  const courseId = step.courseId != null && step.courseId !== '' ? String(step.courseId) : course;
  const lessonId = step.lessonId != null && step.lessonId !== '' ? String(step.lessonId) : lesson;
  return { course, lesson, identity: `${courseId}\n${lessonId}`, progress: lessonProgress(plan, step) };
}

// "Aula N de M": N é a quantidade já concluída + 1, a aula que está em foco.
// Sem total conhecido no roteiro, o Discord fica sem o contador.
export function lessonProgress(plan, step) {
  const courses = plan && Array.isArray(plan.courses) ? plan.courses : [];
  const course = courses.find((item) => item && String(item.id) === String(step?.courseId));
  const total = Number(course?.total);
  const remaining = Number(course?.remaining);
  if (!Number.isInteger(total) || !Number.isInteger(remaining) || total < 1 || remaining < 1 || remaining > total) return null;
  return { current: total - remaining + 1, total };
}

// O relógio fica estável enquanto o curso e a aula não mudam. Uma sessão
// observada (o `since` do aplicativo autorizado) só inicia o relógio; trocar
// de aula com a mesma sessão recomeça em `now`.
export function resolveStartedAt({ identity, previous, now, sessionStartedAt } = {}) {
  const nowMs = toTimestamp(now) || Date.now();
  const session = toTimestamp(sessionStartedAt);
  if (previous && previous.identity === identity && previous.startedAt) return previous.startedAt;
  if (session && (!previous || toTimestamp(previous.sessionStartedAt) !== session)) return Math.min(session, nowMs);
  return nowMs;
}

// Pausa sem punição: texto neutro, sem relógio, curso ou contador.
export function buildPausedActivity({ publicUrl, assetKey = DISCORD_ASSET_KEY } = {}) {
  const activity = {
    details: DISCORD_PAUSED_DETAILS,
    largeImageKey: assetKey,
    largeImageText: DISCORD_LARGE_IMAGE_TEXT,
    instance: false,
  };
  const url = normalizeHttpUrl(publicUrl);
  const label = clipDiscordText(DISCORD_BUTTON_LABEL, BUTTON_LABEL_MAX);
  if (url && label) activity.buttons = [{ label, url }];
  return { activity, identity: 'paused' };
}

// Atividade enviada pela janela do Lume (aula ou PDF aberto, sessão de foco).
// Entrada não confiável: tudo é recortado e conferido aqui.
export function normalizeStudy(value) {
  if (!value || typeof value !== 'object') return null;
  const kind = ['lesson', 'pdf', 'focus'].includes(value.kind) ? value.kind : '';
  if (!kind) return null;
  const int = (n) => (Number.isInteger(n) && n > 0 && n < 1_000_000 ? n : 0);
  const study = {
    kind,
    course: clipDiscordText(value.course),
    lesson: clipDiscordText(value.lesson),
    number: int(value.number),
    total: int(value.total),
    page: int(value.page),
    pages: int(value.pages),
    focus: null,
  };
  const focus = value.focus;
  if (focus && typeof focus === 'object') {
    const elapsed = Number(focus.elapsedMs);
    study.focus = {
      label: clipDiscordText(focus.label),
      paused: focus.paused === true,
      elapsedMs: Number.isFinite(elapsed) && elapsed >= 0 ? Math.min(Math.round(elapsed), 7 * 86_400_000) : 0,
    };
  }
  if (kind === 'focus' && !study.focus) return null;
  return study;
}

export function studyIdentity(study) {
  if (!study) return '';
  if (study.focus) return `focus\n${study.course}\n${study.focus.label}`;
  return `${study.kind}\n${study.course}\n${study.lesson}`;
}

function materialLine(study) {
  if (study.kind === 'pdf') {
    return study.pages ? `Página ${study.page || 1} de ${study.pages}` : `Página ${study.page || 1}`;
  }
  if (study.kind === 'lesson') {
    const aula = study.number ? `Aula ${study.number}` : '';
    return [aula, study.lesson].filter(Boolean).join(' · ');
  }
  return '';
}

export function formatFocusMinutes(ms) {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  if (minutes < 1) return 'menos de 1 min';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

// Status do que está sendo estudado: "Estudando Falência" / "Aula 9 · Título",
// "Lendo Apostila" / "Página 12 de 300", "Em foco · Curso" com o relógio da sessão.
export function buildStudyActivity({ study, startedAt, publicUrl, assetKey = DISCORD_ASSET_KEY } = {}) {
  const activity = {
    largeImageKey: assetKey,
    largeImageText: DISCORD_LARGE_IMAGE_TEXT,
    instance: false,
  };
  const subject = study.course || study.focus?.label || '';
  const line = materialLine(study);
  if (study.focus?.paused) {
    activity.details = clipDiscordText(`Foco em pausa${subject ? ` · ${subject}` : ''}`);
    activity.state = clipDiscordText(`${formatFocusMinutes(study.focus.elapsedMs)} focados`);
  } else if (study.focus) {
    activity.details = clipDiscordText(`Em foco${subject ? ` · ${subject}` : ''}`) || 'Em foco';
    activity.state = clipDiscordText(line) || clipDiscordText(study.focus.label) || 'Sessão de foco';
  } else {
    const verb = study.kind === 'pdf' ? 'Lendo' : 'Estudando';
    activity.details = clipDiscordText(`${verb} ${subject}`) || DISCORD_FALLBACK_DETAILS;
    const text = clipDiscordText(line);
    if (text) activity.state = text;
  }
  const start = study.focus?.paused ? 0 : toTimestamp(startedAt);
  if (start) activity.startTimestamp = start;
  const url = normalizeHttpUrl(publicUrl);
  const label = clipDiscordText(DISCORD_BUTTON_LABEL, BUTTON_LABEL_MAX);
  if (url && label) activity.buttons = [{ label, url }];
  return { activity, identity: studyIdentity(study) };
}

export function buildDiscordActivity({ plan, startedAt, publicUrl, assetKey = DISCORD_ASSET_KEY, paused = false, study = null } = {}) {
  if (paused) return buildPausedActivity({ publicUrl, assetKey });
  if (study) return buildStudyActivity({ study, startedAt, publicUrl, assetKey });
  const lesson = currentLesson(plan);
  const details = lesson?.course || DISCORD_FALLBACK_DETAILS;
  const state = lesson?.lesson && lesson.lesson !== details ? lesson.lesson : '';
  const activity = {
    details,
    largeImageKey: assetKey,
    largeImageText: DISCORD_LARGE_IMAGE_TEXT,
    instance: false,
  };
  if (state) activity.state = state;
  if (state && lesson?.progress) {
    activity.partySize = lesson.progress.current;
    activity.partyMax = lesson.progress.total;
  }
  const start = toTimestamp(startedAt);
  if (start) activity.startTimestamp = start;
  const url = normalizeHttpUrl(publicUrl);
  const label = clipDiscordText(DISCORD_BUTTON_LABEL, BUTTON_LABEL_MAX);
  if (url && label) activity.buttons = [{ label, url }];
  return { activity, identity: lesson?.identity || 'fallback' };
}

export function activityKey(activity) {
  if (!activity) return '';
  const button = Array.isArray(activity.buttons) ? activity.buttons[0] : null;
  return JSON.stringify([
    activity.details || '',
    activity.state || '',
    activity.startTimestamp || 0,
    activity.partySize || 0,
    activity.partyMax || 0,
    activity.largeImageKey || '',
    activity.largeImageText || '',
    button?.label || '',
    button?.url || '',
  ]);
}

export function retryDelayMs(attempt, random = Math.random) {
  const step = Math.max(0, Math.floor(Number(attempt) || 1) - 1);
  const exp = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.min(step, 16));
  const roll = Number(random());
  const unit = Number.isFinite(roll) ? Math.min(1, Math.max(0, roll)) : 0;
  return exp + Math.round(exp * 0.2 * unit);
}

function waitRemaining(lastSentAt, now, minInterval) {
  if (!lastSentAt) return 0;
  return Math.max(0, minInterval - (now - lastSentAt));
}

export function planPresenceUpdate({
  enabled = true,
  configured = true,
  previousKey = '',
  nextKey = '',
  lastSentAt = 0,
  now = 0,
  minInterval = PRESENCE_UPDATE_INTERVAL_MS,
  visible = false,
} = {}) {
  if (!enabled || !configured) {
    if (!visible) return { action: 'idle' };
    const wait = waitRemaining(lastSentAt, now, minInterval);
    return wait > 0 ? { action: 'defer', waitMs: wait, reason: 'clear' } : { action: 'clear' };
  }
  if (!nextKey || nextKey === previousKey) return { action: 'skip' };
  const wait = waitRemaining(lastSentAt, now, minInterval);
  if (wait > 0) return { action: 'defer', waitMs: wait, reason: 'update' };
  return { action: 'send' };
}

function statusOf({ enabled, configured, connected, connecting, attempt }) {
  if (!enabled) return 'off';
  if (!configured) return 'unconfigured';
  if (connected) return 'connected';
  if (attempt > 0 && !connecting) return 'retrying';
  return 'connecting';
}

// Coordena conexão, atualização e limpeza. `createClient` devolve o IPC;
// os testes passam um dublê.
export function createDiscordPresence({
  createClient,
  readSettings,
  now = () => Date.now(),
  schedule = (fn, ms) => setTimeout(fn, ms),
  cancel = (handle) => clearTimeout(handle),
  log = () => {},
  onStatus = () => {},
  random = Math.random,
  coalesceMs = PRESENCE_COALESCE_MS,
  clearTimeoutMs = 1500,
} = {}) {
  if (typeof createClient !== 'function') throw new TypeError('createClient é obrigatório.');
  if (typeof readSettings !== 'function') throw new TypeError('readSettings é obrigatório.');

  let client = null;
  let boundClientId = '';
  let connected = false;
  let connecting = false;
  let stopped = false;
  let attempt = 0;
  let retryTimer = null;
  let flushTimer = null;
  let flushDue = 0;
  let lastSentKey = '';
  let lastSentAt = 0;
  let visible = false;
  let noted = '';
  let clock = null;
  let desiredKey = '';
  let desiredActivity = null;
  let generation = 0;
  let chain = Promise.resolve();

  function enqueue(task) {
    const run = chain.then(() => task());
    chain = run.then(() => undefined, () => undefined);
    return run;
  }

  async function idle() {
    let current;
    do {
      current = chain;
      await current;
    } while (current !== chain);
  }

  function note(code, message) {
    if (noted === code) return;
    noted = code;
    if (message) {
      try { log(message); } catch { /* log não pode derrubar a presença. */ }
    }
  }

  function publish(settings, extra = {}) {
    const snapshot = {
      enabled: settings?.enabled !== false && extra.enabled !== false,
      configured: Boolean(settings?.configured),
      status: statusOf({
        enabled: settings?.enabled !== false && extra.enabled !== false,
        configured: Boolean(settings?.configured),
        connected,
        connecting,
        attempt,
      }),
    };
    if (extra.forceOff) snapshot.status = 'off';
    try { onStatus(snapshot); } catch { /* quem escuta não derruba a presença. */ }
  }

  function clearTimers() {
    if (retryTimer) cancel(retryTimer);
    if (flushTimer) cancel(flushTimer);
    retryTimer = null;
    flushTimer = null;
    flushDue = 0;
  }

  function arm(which, waitMs, fn) {
    const delay = Math.max(0, Math.round(waitMs));
    if (which === 'retry') {
      if (retryTimer) return;
      retryTimer = schedule(() => {
        retryTimer = null;
        enqueue(fn);
      }, delay);
      return;
    }
    const due = now() + delay;
    if (flushTimer && flushDue >= due) return;
    if (flushTimer) cancel(flushTimer);
    flushDue = due;
    flushTimer = schedule(() => {
      flushTimer = null;
      flushDue = 0;
      enqueue(() => fn());
    }, delay);
  }

  function withTimeout(promise, ms) {
    let timer;
    const timeout = new Promise((resolve) => {
      timer = setTimeout(resolve, ms);
      if (typeof timer.unref === 'function') timer.unref();
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }

  async function shutdown({ clear = true } = {}) {
    clearTimers();
    const current = client;
    const wasVisible = visible;
    client = null;
    boundClientId = '';
    connected = false;
    connecting = false;
    generation += 1;
    visible = false;
    lastSentKey = '';
    desiredKey = '';
    desiredActivity = null;
    if (current && clear && wasVisible) {
      try { await withTimeout(Promise.resolve(current.clearActivity()), clearTimeoutMs); } catch { /* encerrar limpa mesmo assim. */ }
    }
    if (current) {
      try { await withTimeout(Promise.resolve(current.destroy()), clearTimeoutMs); } catch { /* já fechado. */ }
    }
  }

  function rememberClock(identity, sessionStartedAt) {
    const startedAt = resolveStartedAt({
      identity,
      previous: clock,
      now: now(),
      sessionStartedAt,
    });
    clock = { identity, startedAt, sessionStartedAt: sessionStartedAt || '' };
    return startedAt;
  }

  // Relógio da sessão de foco: início = agora − tempo decorrido. Diferenças
  // pequenas entre envios (menos de 5 s) mantêm o início anterior, para o status
  // não ser reenviado a cada batimento.
  function focusStart(identity, focus, nowMs) {
    const start = nowMs - focus.elapsedMs;
    if (clock && clock.identity === identity && clock.startedAt && Math.abs(clock.startedAt - start) < FOCUS_DRIFT_MS) return clock.startedAt;
    clock = { identity, startedAt: start, sessionStartedAt: '' };
    return start;
  }

  function compute(companionState, settings) {
    const sessionStartedAt = companionState?.since || '';
    const paused = companionState?.paused === true;
    const study = normalizeStudy(companionState?.study);
    const draft = buildDiscordActivity({
      plan: companionState?.plan,
      publicUrl: settings.publicUrl,
      assetKey: settings.assetKey,
      paused,
      study,
    });
    // Pausar zera o relógio: ao voltar, a contagem recomeça em vez de somar a pausa.
    if (paused) clock = null;
    let startedAt;
    if (paused || study?.focus?.paused) startedAt = 0;
    else if (study?.focus) startedAt = focusStart(draft.identity, study.focus, now());
    else startedAt = rememberClock(draft.identity, study ? '' : sessionStartedAt);
    const built = buildDiscordActivity({
      plan: companionState?.plan,
      paused,
      study,
      startedAt,
      publicUrl: settings.publicUrl,
      assetKey: settings.assetKey,
    });
    desiredActivity = built.activity;
    desiredKey = activityKey(built.activity);
  }

  async function flush({ fromTimer = false } = {}) {
    if (stopped) return;
    const settings = readSettings();
    const decision = planPresenceUpdate({
      enabled: settings.enabled,
      configured: settings.configured,
      previousKey: lastSentKey,
      nextKey: desiredKey,
      lastSentAt,
      now: now(),
      visible,
    });
    if (decision.action === 'idle' || decision.action === 'skip') return;
    if (decision.action === 'defer') {
      arm('flush', decision.waitMs, () => flush({ fromTimer: true }));
      return;
    }
    if (decision.action === 'clear') {
      await shutdown({ clear: true });
      attempt = 0;
      publish(settings);
      return;
    }
    if (!fromTimer && coalesceMs > 0) {
      arm('flush', coalesceMs, () => flush({ fromTimer: true }));
      return;
    }
    if (!connected || !client) {
      if (connecting) arm('flush', Math.max(coalesceMs, 200), () => flush({ fromTimer: true }));
      return;
    }
    const key = desiredKey;
    const activity = desiredActivity;
    const gen = generation;
    try {
      await client.setActivity(activity);
      if (stopped || gen !== generation) return;
      lastSentAt = now();
      visible = true;
      if (desiredKey === key) {
        lastSentKey = key;
        noted = 'ok';
        publish(readSettings());
        return;
      }
      arm('flush', PRESENCE_UPDATE_INTERVAL_MS, () => flush({ fromTimer: true }));
    } catch {
      if (stopped || gen !== generation) return;
      note('retry', 'discord: não foi possível atualizar o status; nova tentativa em silêncio');
      if (connected) arm('flush', PRESENCE_UPDATE_INTERVAL_MS, () => flush({ fromTimer: true }));
    }
  }

  async function ensureConnection(settings) {
    if (stopped || connected || connecting) return;
    if (!settings?.enabled || !settings.configured) return;
    connecting = true;
    const gen = generation;
    const id = settings.clientId;
    publish(settings);
    let created = null;
    try {
      created = await createClient(id);
      if (stopped || gen !== generation || !readSettings().enabled) {
        connecting = false;
        try { await created?.destroy(); } catch { /* cliente descartado. */ }
        return;
      }
      created.onDisconnect(() => {
        enqueue(async () => {
          if (client !== created || stopped) return;
          client = null;
          boundClientId = '';
          connected = false;
          connecting = false;
          visible = false;
          lastSentKey = '';
          generation += 1;
          const current = readSettings();
          if (!current.enabled || !current.configured) {
            publish(current);
            return;
          }
          attempt += 1;
          note('retry', 'discord: conexão encerrada; nova tentativa em silêncio');
          publish(current);
          arm('retry', retryDelayMs(attempt, random), () => ensureConnection(readSettings()));
        });
      });
      await created.connect();
      if (stopped || gen !== generation) {
        connecting = false;
        try { await created.destroy(); } catch { /* cliente descartado. */ }
        return;
      }
      client = created;
      boundClientId = id;
      connected = true;
      connecting = false;
      attempt = 0;
      noted = 'ok';
      publish(readSettings());
      await flush();
    } catch {
      connecting = false;
      if (created && client !== created) {
        try { await created.destroy(); } catch { /* falhou antes de abrir. */ }
      }
      if (stopped || gen !== generation) return;
      const current = readSettings();
      if (!current.enabled || !current.configured) {
        publish(current);
        return;
      }
      if (retryTimer) return;
      attempt += 1;
      note('retry', 'discord: Discord indisponível; nova tentativa em silêncio');
      publish(current);
      arm('retry', retryDelayMs(attempt, random), () => ensureConnection(readSettings()));
    }
  }

  async function apply(companionState) {
    if (stopped) return;
    const settings = readSettings();
    publish(settings);
    if (!settings.enabled || !settings.configured) {
      if (settings.enabled) note('unconfigured', 'discord: Application ID ausente; o status no Discord fica oculto');
      else note('off', '');
      if (client || visible || connecting || retryTimer || flushTimer) await shutdown({ clear: true });
      attempt = 0;
      publish(settings);
      return;
    }
    if (client && boundClientId && boundClientId !== settings.clientId) {
      await shutdown({ clear: true });
      attempt = 0;
    }
    compute(companionState || {}, settings);
    await ensureConnection(settings);
    await flush();
  }

  return {
    sync(companionState) {
      return enqueue(() => apply(companionState));
    },
    stop() {
      return enqueue(async () => {
        stopped = true;
        note('off', '');
        await shutdown({ clear: true });
        publish({ enabled: false, configured: false }, { forceOff: true });
      });
    },
    idle,
  };
}
