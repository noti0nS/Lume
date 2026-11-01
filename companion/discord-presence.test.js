import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readConfig, setDiscordPresence } from './core.mjs';
import {
  DISCORD_ASSET_KEY, DISCORD_BUTTON_LABEL, DISCORD_CLIENT_ID_PLACEHOLDER, DISCORD_FALLBACK_DETAILS,
  PRESENCE_UPDATE_INTERVAL_MS, PUBLIC_SITE_URL, activityKey, buildDiscordActivity, clipDiscordText,
  createDiscordPresence, currentLesson, isUsableClientId, planPresenceUpdate, resolveDiscordSettings,
  resolveStartedAt, retryDelayMs,
} from './discord-presence.mjs';

const CLIENT_ID = '123456789012345678';

function lessonPlan(courseTitle, title, ids = {}) {
  return {
    steps: [{
      courseId: ids.courseId ?? 'curso-1',
      courseTitle,
      lessonId: ids.lessonId ?? 'aula-1',
      title,
    }],
  };
}

function settings(overrides = {}) {
  return {
    enabled: true,
    configured: true,
    clientId: CLIENT_ID,
    publicUrl: PUBLIC_SITE_URL,
    assetKey: DISCORD_ASSET_KEY,
    ...overrides,
  };
}

function harness({ coalesceMs = 0, random = () => 0, initial } = {}) {
  let clock = 1_000_000;
  let current = initial || settings();
  let failuresLeft = 0;
  const logs = [];
  const statuses = [];
  const clients = [];
  const pending = [];
  const presence = createDiscordPresence({
    coalesceMs,
    random,
    now: () => clock,
    log: (message) => logs.push(message),
    onStatus: (status) => statuses.push({ ...status }),
    schedule: (fn, ms) => {
      const handle = { fn, ms, at: clock + ms, cancelled: false };
      pending.push(handle);
      return handle;
    },
    cancel: (handle) => { if (handle) handle.cancelled = true; },
    readSettings: () => current,
    async createClient(id) {
      if (failuresLeft > 0) {
        failuresLeft -= 1;
        throw new Error('offline');
      }
      const created = {
        id,
        activities: [],
        cleared: 0,
        destroyed: false,
        failSend: false,
        failClear: false,
        onDisconnect() {},
        async connect() {},
        async setActivity(activity) {
          if (created.failSend) throw new Error('recusado');
          created.activities.push(activity);
        },
        async clearActivity() {
          if (created.failClear) throw new Error('limpar falhou');
          created.cleared += 1;
        },
        async destroy() { created.destroyed = true; },
      };
      created.onDisconnect = (handler) => { created.disconnect = handler; };
      clients.push(created);
      return created;
    },
  });

  return {
    presence,
    logs,
    statuses,
    clients,
    pending,
    get clock() { return clock; },
    set clock(value) { clock = value; },
    use(next) { current = next; },
    fail(times) { failuresLeft = times; },
    async fire() {
      const due = pending.filter((handle) => !handle.cancelled && handle.at <= clock);
      for (const handle of due) handle.cancelled = true;
      for (const handle of due) handle.fn();
      await presence.idle();
    },
  };
}

test('o interruptor do Discord fica na configuração do aplicativo, ligado por padrão', () => {
  const directory = mkdtempSync(join(tmpdir(), 'lume-discord-'));
  const previousHome = process.env.HOME;
  const previousAppData = process.env.APPDATA;
  if (process.platform === 'win32') process.env.APPDATA = directory;
  else process.env.HOME = directory;
  try {
    const initial = readConfig();
    assert.equal(initial.discordPresence, true);
    assert.equal(initial.discordClientId, DISCORD_CLIENT_ID_PLACEHOLDER);
    assert.equal(setDiscordPresence(false).discordPresence, false);
    assert.equal(readConfig().discordClientId, DISCORD_CLIENT_ID_PLACEHOLDER);
    assert.equal(setDiscordPresence(true).discordPresence, true);
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousAppData === undefined) delete process.env.APPDATA;
    else process.env.APPDATA = previousAppData;
    rmSync(directory, { recursive: true, force: true });
  }
});

test('sem roteiro o status é o texto genérico, com logo e botão', () => {
  for (const plan of [null, undefined, {}, { steps: [] }, { steps: [{ title: 'A', courseTitle: '' }] }]) {
    const { activity } = buildDiscordActivity({ plan, startedAt: 1_700_000_000_000, publicUrl: PUBLIC_SITE_URL });
    assert.equal(activity.details, DISCORD_FALLBACK_DETAILS);
    assert.equal(activity.state, undefined);
    assert.equal(activity.largeImageKey, DISCORD_ASSET_KEY);
    assert.equal(activity.largeImageText, 'Lume');
    assert.equal(activity.startTimestamp, 1_700_000_000_000);
    assert.deepEqual(activity.buttons, [{ label: DISCORD_BUTTON_LABEL, url: PUBLIC_SITE_URL }]);
  }
});

test('curso vai em details e aula em state, com texto cortado', () => {
  const course = `Direito ${'Constitucional '.repeat(20)}`;
  const { activity, identity } = buildDiscordActivity({
    plan: lessonPlan(course, '  Aula   2 — Direitos fundamentais  ', { courseId: 'c1', lessonId: 'l2' }),
    startedAt: '2026-11-01T12:00:00.000Z',
    publicUrl: PUBLIC_SITE_URL,
  });
  assert.equal(activity.details, clipDiscordText(course));
  assert.equal(activity.details.length, 128);
  assert.equal(activity.state, 'Aula 2 — Direitos fundamentais');
  assert.equal(activity.startTimestamp, Date.parse('2026-11-01T12:00:00.000Z'));
  assert.equal(identity, 'c1\nl2');
  assert.equal(currentLesson(lessonPlan('Curso', 'Aula')).course, 'Curso');
});

test('omite o estado quando repete o curso e omite o botão sem https', () => {
  const same = buildDiscordActivity({
    plan: lessonPlan('Leitura', 'Leitura'),
    publicUrl: 'http://127.0.0.1:4173',
  });
  assert.equal(same.activity.details, 'Leitura');
  assert.equal(same.activity.state, undefined);
  assert.equal(same.activity.buttons, undefined);

  const bad = buildDiscordActivity({ plan: lessonPlan('Curso', 'Aula'), publicUrl: 'javascript:alert(1)' });
  assert.equal(bad.activity.buttons, undefined);
});

test('a chave da atividade muda com o conteúdo e ignora o relógio correndo', () => {
  const first = buildDiscordActivity({
    plan: lessonPlan('Curso', 'Aula 1', { lessonId: 'l1' }),
    startedAt: 1000,
    publicUrl: PUBLIC_SITE_URL,
  }).activity;
  const same = buildDiscordActivity({
    plan: lessonPlan('Curso', 'Aula 1', { lessonId: 'l1' }),
    startedAt: 1000,
    publicUrl: PUBLIC_SITE_URL,
  }).activity;
  const next = buildDiscordActivity({
    plan: lessonPlan('Curso', 'Aula 2', { lessonId: 'l2' }),
    startedAt: 1000,
    publicUrl: PUBLIC_SITE_URL,
  }).activity;
  assert.equal(activityKey(first), activityKey(same));
  assert.notEqual(activityKey(first), activityKey(next));
});

test('o relógio começa na sessão e fica estável até trocar a aula', () => {
  const first = resolveStartedAt({ identity: 'a', now: 5_000, sessionStartedAt: 1_000 });
  assert.equal(first, 1_000);
  const kept = resolveStartedAt({
    identity: 'a',
    previous: { identity: 'a', startedAt: 1_000, sessionStartedAt: 1_000 },
    now: 9_000,
    sessionStartedAt: 1_000,
  });
  assert.equal(kept, 1_000);
  const changed = resolveStartedAt({
    identity: 'b',
    previous: { identity: 'a', startedAt: 1_000, sessionStartedAt: 1_000 },
    now: 9_000,
    sessionStartedAt: 1_000,
  });
  assert.equal(changed, 9_000);
  const newSession = resolveStartedAt({
    identity: 'b',
    previous: { identity: 'a', startedAt: 1_000, sessionStartedAt: 1_000 },
    now: 9_000,
    sessionStartedAt: 8_000,
  });
  assert.equal(newSession, 8_000);
});

test('atualiza só quando o conteúdo muda e nunca antes de 15s', () => {
  assert.deepEqual(planPresenceUpdate({ previousKey: 'a', nextKey: 'a', lastSentAt: 0, now: 20_000 }), { action: 'skip' });
  assert.equal(planPresenceUpdate({ previousKey: '', nextKey: 'a', lastSentAt: 0, now: 0 }).action, 'send');
  const deferred = planPresenceUpdate({ previousKey: 'a', nextKey: 'b', lastSentAt: 1_000, now: 2_000 });
  assert.equal(deferred.action, 'defer');
  assert.equal(deferred.waitMs, PRESENCE_UPDATE_INTERVAL_MS - 1_000);
  assert.equal(planPresenceUpdate({ previousKey: 'a', nextKey: 'b', lastSentAt: 1_000, now: 16_000 }).action, 'send');
  assert.equal(planPresenceUpdate({ enabled: false, visible: true, lastSentAt: 0, now: 0 }).action, 'clear');
  assert.equal(planPresenceUpdate({ enabled: false, visible: false }).action, 'idle');
  assert.equal(planPresenceUpdate({ configured: false, visible: true, lastSentAt: 0, now: 0 }).action, 'clear');
});

test('a espera entre tentativas dobra e tem teto', () => {
  assert.equal(retryDelayMs(1, () => 0), 5_000);
  assert.equal(retryDelayMs(2, () => 0), 10_000);
  assert.equal(retryDelayMs(3, () => 0), 20_000);
  assert.equal(retryDelayMs(1, () => 1), 6_000);
  assert.equal(retryDelayMs(20, () => 0), 5 * 60_000);
  assert.ok(retryDelayMs(20, () => 1) <= 5 * 60_000 * 1.2);
});

test('o Application ID vem do ambiente ou da configuração e o marcador desliga', () => {
  assert.equal(isUsableClientId(DISCORD_CLIENT_ID_PLACEHOLDER), false);
  assert.equal(isUsableClientId('123'), false);
  assert.equal(isUsableClientId(CLIENT_ID), true);

  const missing = resolveDiscordSettings({ discordPresence: true, discordClientId: DISCORD_CLIENT_ID_PLACEHOLDER });
  assert.equal(missing.enabled, true);
  assert.equal(missing.configured, false);
  assert.equal(missing.publicUrl, PUBLIC_SITE_URL);

  const fromEnv = resolveDiscordSettings(
    { discordClientId: '999999999999999999', discordPublicUrl: 'http://localhost:4173' },
    { LUME_DISCORD_CLIENT_ID: CLIENT_ID, LUME_DISCORD_PUBLIC_URL: 'https://estudos.example' },
  );
  assert.equal(fromEnv.clientId, CLIENT_ID);
  assert.equal(fromEnv.publicUrl, 'https://estudos.example');

  const fromConfig = resolveDiscordSettings(
    { discordClientId: CLIENT_ID, discordPublicUrl: 'https://lume.example/app' },
    { LUME_DISCORD_CLIENT_ID: DISCORD_CLIENT_ID_PLACEHOLDER },
  );
  assert.equal(fromConfig.clientId, CLIENT_ID);
  assert.equal(fromConfig.publicUrl, 'https://lume.example/app');

  const off = resolveDiscordSettings({ discordPresence: false, discordClientId: CLIENT_ID });
  assert.equal(off.enabled, false);
  assert.equal(off.configured, true);
  assert.equal(resolveDiscordSettings({}).enabled, true);
});

test('publica curso e aula uma vez e não repete o mesmo conteúdo', async () => {
  const box = harness();
  const since = new Date(box.clock - 60_000).toISOString();
  await box.presence.sync({ plan: lessonPlan('Direito Constitucional', 'Aula 2'), since });
  const sent = box.clients[0].activities;
  assert.equal(sent.length, 1);
  assert.equal(sent[0].details, 'Direito Constitucional');
  assert.equal(sent[0].state, 'Aula 2');
  assert.equal(sent[0].largeImageKey, DISCORD_ASSET_KEY);
  assert.equal(sent[0].startTimestamp, box.clock - 60_000);
  assert.equal(sent[0].buttons[0].label, DISCORD_BUTTON_LABEL);
  assert.equal(sent[0].buttons[0].url, PUBLIC_SITE_URL);

  box.clock += 60_000;
  await box.presence.sync({ plan: lessonPlan('Direito Constitucional', 'Aula 2'), since });
  assert.equal(box.clients[0].activities.length, 1);
  assert.equal(box.statuses.at(-1).status, 'connected');
});

test('segura a troca de aula pelo limite e envia a versão mais recente', async () => {
  const box = harness();
  await box.presence.sync({ plan: lessonPlan('Curso', 'Aula 1', { lessonId: 'l1' }) });
  box.clock += 1_000;
  await box.presence.sync({ plan: lessonPlan('Curso', 'Aula 2', { lessonId: 'l2' }) });
  await box.presence.sync({ plan: lessonPlan('Curso', 'Aula 3', { lessonId: 'l3' }) });
  assert.equal(box.clients[0].activities.length, 1);

  box.clock += PRESENCE_UPDATE_INTERVAL_MS;
  await box.fire();
  assert.equal(box.clients[0].activities.length, 2);
  assert.equal(box.clients[0].activities[1].state, 'Aula 3');
  assert.equal(box.clients[0].activities[1].startTimestamp, box.clock - PRESENCE_UPDATE_INTERVAL_MS);
});

test('várias leituras seguidas viram um único envio, com a aula mais nova', async () => {
  const box = harness({ coalesceMs: 400 });
  await box.presence.sync({ plan: null });
  await box.presence.sync({ plan: lessonPlan('Curso', 'Aula 1') });
  assert.equal(box.clients[0].activities.length, 0);
  box.clock += 400;
  await box.fire();
  assert.equal(box.clients[0].activities.length, 1);
  assert.equal(box.clients[0].activities[0].details, 'Curso');
  assert.equal(box.clients[0].activities[0].state, 'Aula 1');
});

test('sem Application ID não conecta e avisa uma vez só', async () => {
  const box = harness({
    initial: settings({ configured: false, clientId: '' }),
  });
  await box.presence.sync({ plan: lessonPlan('Curso', 'Aula') });
  await box.presence.sync({ plan: lessonPlan('Curso', 'Aula') });
  assert.equal(box.clients.length, 0);
  assert.equal(box.logs.length, 1);
  assert.match(box.logs[0], /Application ID ausente/);
  assert.equal(box.statuses.at(-1).status, 'unconfigured');
  assert.equal(box.statuses.at(-1).enabled, true);
});

test('Discord fechado gera novas tentativas em silêncio, com espera crescente', async () => {
  const box = harness();
  box.fail(2);
  await box.presence.sync({ plan: null });
  assert.equal(box.clients.length, 0);
  assert.equal(box.logs.length, 1);
  assert.match(box.logs[0], /indisponível/);
  assert.equal(box.statuses.at(-1).status, 'retrying');

  box.clock += 5_000;
  await box.fire();
  assert.equal(box.logs.length, 1);
  assert.equal(box.clients.length, 0);

  box.clock += 10_000;
  await box.fire();
  assert.equal(box.clients.length, 1);
  assert.equal(box.clients[0].activities[0].details, DISCORD_FALLBACK_DETAILS);
  assert.equal(box.logs.length, 1);
  assert.equal(box.statuses.at(-1).status, 'connected');
});

test('desconectar o Discord agenda outra tentativa e republica o status', async () => {
  const box = harness();
  await box.presence.sync({ plan: lessonPlan('Curso', 'Aula 1') });
  box.clients[0].disconnect();
  await box.presence.idle();
  assert.equal(box.logs.length, 1);
  assert.match(box.logs[0], /conexão encerrada/);
  assert.equal(box.statuses.at(-1).status, 'retrying');

  box.clock += 5_000;
  await box.fire();
  assert.equal(box.clients.length, 2);
  assert.equal(box.clients[1].activities.length, 0);

  box.clock += PRESENCE_UPDATE_INTERVAL_MS - 5_000;
  await box.fire();
  assert.equal(box.clients[1].activities.length, 1);
  assert.equal(box.clients[1].activities[0].state, 'Aula 1');
});

test('desligar limpa a atividade e não volta a conectar', async () => {
  const box = harness();
  await box.presence.sync({ plan: lessonPlan('Curso', 'Aula 1') });
  box.use(settings({ enabled: false }));
  await box.presence.sync({ plan: lessonPlan('Curso', 'Aula 1') });
  assert.equal(box.clients[0].cleared, 1);
  assert.equal(box.clients[0].destroyed, true);
  assert.equal(box.statuses.at(-1).status, 'off');
  assert.equal(box.statuses.at(-1).enabled, false);

  box.clock += 60_000;
  await box.fire();
  await box.presence.sync({ plan: lessonPlan('Curso', 'Aula 2', { lessonId: 'l2' }) });
  assert.equal(box.clients.length, 1);
});

test('falha ao limpar ainda encerra o cliente', async () => {
  const box = harness();
  await box.presence.sync({ plan: null });
  box.clients[0].failClear = true;
  await box.presence.stop();
  assert.equal(box.clients[0].destroyed, true);
  await box.presence.sync({ plan: lessonPlan('Curso', 'Aula') });
  assert.equal(box.clients.length, 1);
});

test('sair limpa o status mesmo com uma atualização pendente', async () => {
  const box = harness();
  await box.presence.sync({ plan: lessonPlan('Curso', 'Aula 1', { lessonId: 'l1' }) });
  box.clock += 1_000;
  await box.presence.sync({ plan: lessonPlan('Curso', 'Aula 2', { lessonId: 'l2' }) });
  await box.presence.stop();
  assert.equal(box.clients[0].cleared, 1);
  assert.equal(box.clients[0].destroyed, true);
  box.clock += PRESENCE_UPDATE_INTERVAL_MS;
  await box.fire();
  assert.equal(box.clients[0].activities.length, 1);
});

test('recusa ao enviar não repete o aviso e tenta de novo depois do limite', async () => {
  const box = harness();
  await box.presence.sync({ plan: null });
  box.clients[0].failSend = true;
  box.clock += PRESENCE_UPDATE_INTERVAL_MS;
  await box.presence.sync({ plan: lessonPlan('Curso', 'Aula 1') });
  assert.equal(box.logs.length, 1);
  await box.presence.sync({ plan: lessonPlan('Curso', 'Aula 2', { lessonId: 'l2' }) });
  assert.equal(box.logs.length, 1);
  box.clients[0].failSend = false;
  box.clock += PRESENCE_UPDATE_INTERVAL_MS;
  await box.fire();
  assert.equal(box.clients[0].activities.at(-1).state, 'Aula 2');
});
