// Livro de eventos de XP e ranking — compartilhado entre o servidor Node e o
// Worker/D1. Nenhuma função aqui confia no valor enviado pelo navegador: o tipo,
// o material e a elegibilidade são revalidados a partir do estado sincronizado.

import { restoreState } from './public/domain.js';
import {
  DAILY_TIME_XP_CAP, DEFAULT_TIME_ZONE, LEVEL_XP, TIME_BLOCK_SECONDS, TIME_BLOCK_XP,
  XP_POLICY_VERSION, XP_VALUES, bonusEventKey, bonusKindForCourse, completionKindForCourse,
  completionTimestamp, courseGradeIsComplete, courseIsComplete, isEligibleCourse, isImportedCourse,
  levelProgress, localDay, normalizeTimeZone, periodDays, slideEventKey, slideProgressSnapshot,
  stepEventKey, timeEventKey,
} from './public/xp-policy.js';

export class XpError extends Error {
  constructor(message, code = 'xp_error', status = 400) {
    super(message);
    this.name = 'XpError';
    this.code = code;
    this.status = status;
  }
}

const MAX_TIME_SECONDS = 12 * 60 * 60;

function iso(value) {
  return new Date(value).toISOString();
}

function integer(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function serializeEvent(row) {
  let meta = null;
  try { meta = row.meta ? JSON.parse(row.meta) : null; } catch { meta = null; }
  return {
    id: row.id,
    eventKey: row.event_key,
    kind: row.kind,
    xp: Number(row.xp),
    materialId: row.material_id || '',
    materialTitle: row.material_title || '',
    stepId: row.step_id || '',
    stepTitle: row.step_title || '',
    sessionId: row.session_id || '',
    origin: row.origin,
    policyVersion: row.policy_version,
    day: row.local_day || null,
    at: row.granted_at,
    correctsId: meta?.corrects || '',
    reason: meta?.reason || '',
  };
}

function serializeAchievement(row) {
  return {
    id: row.id,
    kind: row.kind,
    materialId: row.material_id,
    title: row.material_title,
    criterion: row.criterion,
    origin: row.origin,
    visibility: row.visibility,
    earnedAt: row.earned_at,
  };
}

function serializeSettings(row) {
  if (!row) return null;
  return {
    eligibleSince: row.eligible_since,
    timeZone: row.time_zone,
    rankingOptIn: Number(row.ranking_opt_in) === 1,
    updatedAt: row.updated_at,
  };
}

export function xpPolicy() {
  return {
    version: XP_POLICY_VERSION,
    levelXp: LEVEL_XP,
    values: { ...XP_VALUES },
    blockSeconds: TIME_BLOCK_SECONDS,
    blockXp: TIME_BLOCK_XP,
    dailyTimeCap: DAILY_TIME_XP_CAP,
  };
}

async function readSettings(db, userId) {
  return db.first('SELECT * FROM xp_settings WHERE user_id = ?', [userId]);
}

// Cria as configurações no primeiro contato. `eligibleSince` é imutável: tudo
// que foi concluído antes dele continua no saldo legado.
export async function ensureXpSettings(db, userId, { now = Date.now(), timeZone = '', create = true, updateTimeZone = false } = {}) {
  let row = await readSettings(db, userId);
  if (!row && create) {
    const created = iso(now);
    await db.run(
      `INSERT OR IGNORE INTO xp_settings
        (user_id, eligible_since, time_zone, consumed_seconds, ranking_opt_in, updated_at)
       VALUES (?, ?, ?, 0, 0, ?)`,
      [userId, created, normalizeTimeZone(timeZone || DEFAULT_TIME_ZONE), created],
    );
    row = await readSettings(db, userId);
  }
  if (row && updateTimeZone && timeZone) {
    const zone = normalizeTimeZone(timeZone);
    if (zone !== row.time_zone) {
      await db.run('UPDATE xp_settings SET time_zone = ?, updated_at = ? WHERE user_id = ?', [zone, iso(now), userId]);
      row = await readSettings(db, userId);
    }
  }
  return row;
}

async function loadState(db, userId) {
  const row = await db.first('SELECT state FROM user_state WHERE user_id = ?', [userId]);
  if (!row?.state) {
    throw new XpError('Salve seu progresso na conta antes de registrar XP.', 'state_missing', 409);
  }
  return restoreState(row.state);
}

function findCourse(state, courseId) {
  return (state.courses || []).find((course) => course.id === courseId) || null;
}

async function findEvent(db, userId, eventKey) {
  return db.first('SELECT * FROM xp_events WHERE user_id = ? AND event_key = ?', [userId, eventKey]);
}

async function insertEvent(db, userId, event) {
  const id = event.id || crypto.randomUUID();
  try {
    await db.run(
      `INSERT INTO xp_events
        (id, user_id, event_key, kind, xp, material_id, material_title, step_id, step_title,
         session_id, origin, policy_version, local_day, granted_at, meta)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, userId, event.key, event.kind, event.xp,
        event.materialId || '', event.materialTitle || '', event.stepId || '', event.stepTitle || '',
        event.sessionId || '', event.origin || 'manual', XP_POLICY_VERSION,
        event.day || null, event.at || iso(Date.now()), event.meta || null,
      ],
    );
    return db.first('SELECT * FROM xp_events WHERE id = ?', [id]);
  } catch (error) {
    // Corrida entre duas requisições: a chave única venceu, então a segunda é
    // tratada como repetição, não como erro.
    const existing = await findEvent(db, userId, event.key);
    if (existing) return existing;
    throw error;
  }
}

async function insertAchievement(db, userId, { event, kind, title, criterion }) {
  const id = crypto.randomUUID();
  await db.run(
    `INSERT OR IGNORE INTO user_achievements
      (id, user_id, event_id, kind, material_id, material_title, criterion, policy_version,
       origin, visibility, earned_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'friends', ?)`,
    [
      id, userId, event.id, kind, event.material_id || '', title, criterion,
      XP_POLICY_VERSION, event.origin || 'manual', event.granted_at,
    ],
  );
}

async function achievementForStep(db, userId, event, course, step) {
  if (event.kind === 'reading') {
    await insertAchievement(db, userId, {
      event,
      kind: 'reading',
      title: course.steps.length === 1 ? course.title : `${step.title} — ${course.title}`,
      criterion: 'Leitura delimitada concluída',
    });
  } else if (event.kind === 'exercise') {
    await insertAchievement(db, userId, {
      event,
      kind: 'exercise',
      title: course.steps.length === 1 ? course.title : `${step.title} — ${course.title}`,
      criterion: 'Lista de exercícios concluída',
    });
  }
}

async function achievementForBonus(db, userId, event, course) {
  if (event.kind === 'project_bonus') {
    await insertAchievement(db, userId, {
      event, kind: 'project', title: course.title, criterion: 'Todas as entregas obrigatórias concluídas',
    });
  } else {
    await insertAchievement(db, userId, {
      event, kind: 'course', title: course.title, criterion: 'Todas as unidades obrigatórias concluídas',
    });
  }
}

export async function xpSummary(db, userId, settings = null, now = Date.now()) {
  const config = settings || await readSettings(db, userId);
  if (!config) {
    return {
      totalXP: 0,
      level: 1,
      levelCurrent: 0,
      levelNext: LEVEL_XP,
      coursesCompleted: 0,
      projectsCompleted: 0,
      timeXP: 0,
      dailyTimeXP: 0,
      dailyTimeCap: DAILY_TIME_XP_CAP,
      carrySeconds: 0,
      achievements: 0,
      events: 0,
    };
  }
  const totals = await db.first(
    `SELECT COALESCE(SUM(xp), 0) AS total,
            COALESCE(SUM(CASE WHEN kind = 'course_bonus' THEN 1 ELSE 0 END), 0) AS courses,
            COALESCE(SUM(CASE WHEN kind = 'project_bonus' THEN 1 ELSE 0 END), 0) AS projects,
            COALESCE(SUM(CASE WHEN kind = 'time_block' THEN xp ELSE 0 END), 0) AS time_xp,
            COUNT(*) AS events
       FROM xp_events WHERE user_id = ?`,
    [userId],
  );
  // O dia segue o relógio já aceito por getXpSnapshot. Sem isso, o teto diário
  // lia o calendário da máquina e o teste de 31/10 falhava em qualquer outro dia.
  const day = localDay(config.time_zone, new Date(now));
  const today = await db.first(
    `SELECT COALESCE(SUM(xp), 0) AS xp FROM xp_events
      WHERE user_id = ? AND kind = 'time_block' AND local_day = ?`,
    [userId, day],
  );
  const badges = await db.first('SELECT COUNT(*) AS total FROM user_achievements WHERE user_id = ? AND revoked_at IS NULL', [userId]);
  const total = Number(totals?.total || 0);
  const level = levelProgress(total);
  return {
    totalXP: total,
    level: level.level,
    levelCurrent: level.current,
    levelNext: level.next,
    coursesCompleted: Number(totals?.courses || 0),
    projectsCompleted: Number(totals?.projects || 0),
    timeXP: Number(totals?.time_xp || 0),
    dailyTimeXP: Number(today?.xp || 0),
    dailyTimeCap: DAILY_TIME_XP_CAP,
    carrySeconds: Number(config.consumed_seconds || 0) % TIME_BLOCK_SECONDS,
    achievements: Number(badges?.total || 0),
    events: Number(totals?.events || 0),
  };
}

// `create: false` é usado pelo perfil de outra pessoa: consultar um perfil não
// pode iniciar a política de XP de quem ainda não a abriu.
export async function getXpSnapshot(db, userId, { now = Date.now(), timeZone = '', create = true } = {}) {
  const settings = await ensureXpSettings(db, userId, {
    now, timeZone, create, updateTimeZone: create && Boolean(timeZone),
  });
  if (!settings) {
    return {
      policy: xpPolicy(),
      summary: await xpSummary(db, userId, null, now),
      settings: null,
      events: [],
      achievements: [],
    };
  }
  const events = await db.all(
    `SELECT * FROM xp_events WHERE user_id = ? ORDER BY granted_at DESC, id DESC LIMIT 100`,
    [userId],
  );
  const achievements = await db.all(
    `SELECT * FROM user_achievements WHERE user_id = ? AND revoked_at IS NULL ORDER BY earned_at DESC LIMIT 50`,
    [userId],
  );
  return {
    policy: xpPolicy(),
    summary: await xpSummary(db, userId, settings, now),
    settings: serializeSettings(settings),
    events: events.map(serializeEvent),
    achievements: achievements.map(serializeAchievement),
  };
}

// Concessão de uma unidade de estudo (aula, leitura, exercício ou entrega).
// O cliente informa apenas o material e a etapa; tipo e valor são derivados do
// estado, nunca do corpo da requisição.
export async function grantStep(db, userId, { courseId, stepId }, { now = Date.now() } = {}) {
  if (typeof courseId !== 'string' || !courseId || courseId.length > 120) {
    throw new XpError('Material inválido.', 'invalid_material', 400);
  }
  if (typeof stepId !== 'string' || !stepId || stepId.length > 160) {
    throw new XpError('Etapa inválida.', 'invalid_step', 400);
  }
  const settings = await ensureXpSettings(db, userId, { now });
  const state = await loadState(db, userId);
  const course = findCourse(state, courseId);
  if (!course || !isEligibleCourse(course)) {
    throw new XpError('Este material não participa da política de XP.', 'material_not_eligible', 409);
  }
  const step = course.steps.find((item) => item.id === stepId);
  if (!step) throw new XpError('Etapa não encontrada.', 'step_not_found', 404);
  if (!(state.completed || []).includes(stepId)) {
    throw new XpError('Conclua a etapa antes de registrar o XP.', 'step_not_completed', 409);
  }
  const at = completionTimestamp(state, course, stepId);
  if (!Number.isFinite(at) || at < Date.parse(settings.eligible_since)) {
    throw new XpError('Este progresso é anterior à política atual e permanece como saldo legado.', 'legacy_progress', 409);
  }
  const kind = completionKindForCourse(course);
  const key = stepEventKey(kind, course.id, step.id);
  const existing = await findEvent(db, userId, key);
  if (existing) return { added: false, duplicate: true, event: serializeEvent(existing) };
  const event = await insertEvent(db, userId, {
    key, kind, xp: XP_VALUES[kind],
    materialId: course.id, materialTitle: course.title,
    stepId: step.id, stepTitle: step.title,
    origin: 'manual', day: localDay(settings.time_zone, new Date(now)), at: iso(now),
  });
  await achievementForStep(db, userId, event, course, step);
  return { added: true, duplicate: false, event: serializeEvent(event) };
}

// Bônus de contêiner: apenas quando todas as unidades obrigatórias foram
// concluídas depois do marco da política. Curso parcial não conclui o curso.
export async function grantBonus(db, userId, { courseId }, { now = Date.now() } = {}) {
  if (typeof courseId !== 'string' || !courseId || courseId.length > 120) {
    throw new XpError('Material inválido.', 'invalid_material', 400);
  }
  const settings = await ensureXpSettings(db, userId, { now });
  const state = await loadState(db, userId);
  const course = findCourse(state, courseId);
  if (!course || !isEligibleCourse(course)) {
    throw new XpError('Este material não participa da política de XP.', 'material_not_eligible', 409);
  }
  if (!courseGradeIsComplete(course)) {
    throw new XpError('Uma grade parcial não conclui o curso inteiro.', 'partial_grade', 409);
  }
  if (!courseIsComplete(state, course)) {
    throw new XpError('Ainda há unidades obrigatórias em aberto.', 'course_not_complete', 409);
  }
  const minimum = course.type === 'project' ? 1 : 2;
  if (!isImportedCourse(course) && course.steps.length < minimum) {
    throw new XpError('Um material de uma única etapa não recebe bônus de conclusão.', 'too_short', 409);
  }
  for (const step of course.steps) {
    const at = completionTimestamp(state, course, step.id);
    if (!Number.isFinite(at) || at < Date.parse(settings.eligible_since)) {
      throw new XpError('A conclusão inclui etapas anteriores à política atual; o bônus não é retroativo.', 'legacy_progress', 409);
    }
  }
  const kind = bonusKindForCourse(course);
  const key = bonusEventKey(kind, course.id);
  const existing = await findEvent(db, userId, key);
  if (existing) return { added: false, duplicate: true, event: serializeEvent(existing) };
  const event = await insertEvent(db, userId, {
    key, kind, xp: XP_VALUES[kind],
    materialId: course.id, materialTitle: course.title,
    stepId: '', stepTitle: '',
    origin: 'manual', day: localDay(settings.time_zone, new Date(now)), at: iso(now),
  });
  await achievementForBonus(db, userId, event, course);
  return { added: true, duplicate: false, event: serializeEvent(event) };
}

// Apresentação interna: XP único quando a pessoa viu pelo menos 80% dos
// slides, chegou ao último e confirmou a conclusão. Abrir ou pular direto para
// o fim não satisfaz o critério; o servidor revalida o progresso salvo.
export async function grantSlide(db, userId, { courseId }, { now = Date.now() } = {}) {
  if (typeof courseId !== 'string' || !courseId || courseId.length > 120) {
    throw new XpError('Material inválido.', 'invalid_material', 400);
  }
  const settings = await ensureXpSettings(db, userId, { now });
  const state = await loadState(db, userId);
  const course = findCourse(state, courseId);
  if (!course || !isEligibleCourse(course)) {
    throw new XpError('Este material não participa da política de XP.', 'material_not_eligible', 409);
  }
  const deck = slideProgressSnapshot(course);
  if (!deck.total) throw new XpError('Este material ainda não tem slides.', 'slides_missing', 409);
  if (!deck.nearEnd || !deck.lastSeen || !deck.completedAt) {
    throw new XpError('Conclua a apresentação com pelo menos 80% dos slides vistos e o último slide aberto.', 'deck_not_complete', 409);
  }
  if (Date.parse(deck.completedAt) < Date.parse(settings.eligible_since)) {
    throw new XpError('Esta apresentação foi concluída antes da política atual e permanece como histórico legado.', 'legacy_progress', 409);
  }
  const key = slideEventKey(course.id);
  const existing = await findEvent(db, userId, key);
  if (existing) return { added: false, duplicate: true, event: serializeEvent(existing) };
  const event = await insertEvent(db, userId, {
    key, kind: 'slide', xp: XP_VALUES.slide,
    materialId: course.id, materialTitle: course.title,
    stepId: '', stepTitle: '',
    origin: 'manual', day: localDay(settings.time_zone, new Date(now)), at: iso(now),
  });
  await insertAchievement(db, userId, {
    event, kind: 'slide', title: course.title, criterion: 'Apresentação concluída com cobertura do deck',
  });
  return { added: true, duplicate: false, event: serializeEvent(event) };
}

// Correção assistida: um evento negativo vinculado ao original, com motivo.
// O original não é apagado; conquistas ligadas a ele são revogadas e o extrato
// mostra a correção. Repetir a correção não duplica o ajuste.
export async function adjustEvent(db, userId, { eventId, reason }, { now = Date.now() } = {}) {
  if (typeof eventId !== 'string' || !eventId) throw new XpError('Evento inválido.', 'invalid_event', 400);
  const cleanReason = String(reason ?? '').replace(/\s+/g, ' ').trim().slice(0, 240);
  if (cleanReason.length < 3) throw new XpError('Explique o motivo da correção (pelo menos 3 caracteres).', 'reason_required', 400);
  const event = await db.first('SELECT * FROM xp_events WHERE id = ? AND user_id = ?', [eventId, userId]);
  if (!event) throw new XpError('Evento não encontrado.', 'event_not_found', 404);
  if (event.kind === 'adjustment' || Number(event.xp) <= 0) {
    throw new XpError('Este evento não pode ser corrigido por esta ação.', 'event_not_adjustable', 400);
  }
  const key = `adjust|${event.id}`;
  const existing = await findEvent(db, userId, key);
  if (existing) return { added: false, duplicate: true, event: serializeEvent(existing) };
  const settings = await ensureXpSettings(db, userId, { now });
  const adjustment = await insertEvent(db, userId, {
    key,
    kind: 'adjustment',
    xp: -Number(event.xp),
    materialId: event.material_id || '',
    materialTitle: event.material_title || '',
    stepId: event.step_id || '',
    stepTitle: event.step_title || '',
    sessionId: event.session_id || '',
    origin: 'manual',
    day: localDay(settings.time_zone, new Date(now)),
    at: iso(now),
    meta: JSON.stringify({ corrects: event.id, reason: cleanReason }),
  });
  await db.run(
    'UPDATE user_achievements SET revoked_at = ? WHERE user_id = ? AND event_id = ? AND revoked_at IS NULL',
    [iso(now), userId, event.id],
  );
  return { added: true, duplicate: false, event: serializeEvent(adjustment) };
}

// Sessão declarada: o servidor desconta sobreposição com outras sessões já
// registradas, fecha blocos de 30 minutos e aplica o teto diário. O excedente
// do teto é descartado do acumulador, conforme a política.
export async function recordTimeSession(db, userId, input, { now = Date.now() } = {}) {
  const sessionId = typeof input?.sessionId === 'string' ? input.sessionId.trim() : '';
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(sessionId)) {
    throw new XpError('Identificador de sessão inválido.', 'invalid_session', 400);
  }
  const started = Date.parse(input?.startedAt);
  const ended = Date.parse(input?.endedAt);
  const declared = integer(input?.durationSeconds);
  if (!Number.isFinite(started) || !Number.isFinite(ended) || ended <= started) {
    throw new XpError('A sessão precisa ter início e fim válidos.', 'invalid_interval', 400);
  }
  if (declared === null || declared <= 0) {
    throw new XpError('A sessão não tem tempo declarado.', 'empty_session', 400);
  }
  const wallSeconds = Math.floor((ended - started) / 1000);
  if (declared > wallSeconds + 5) {
    throw new XpError('O tempo declarado não pode ser maior que o intervalo da sessão.', 'invalid_duration', 400);
  }
  const duration = Math.min(declared, MAX_TIME_SECONDS, wallSeconds);
  if (duration <= 0) throw new XpError('A sessão não tem tempo declarado.', 'empty_session', 400);

  const settings = await ensureXpSettings(db, userId, { now });
  if (ended < Date.parse(settings.eligible_since)) {
    throw new XpError('Esta sessão é anterior à política atual e permanece como histórico legado.', 'legacy_session', 409);
  }

  const startedIso = iso(started);
  const endedIso = iso(ended);

  let row = await db.first(
    'SELECT * FROM xp_time_sessions WHERE user_id = ? AND session_id = ?',
    [userId, sessionId],
  );
  if (!row) {
    const overlaps = await db.all(
      `SELECT started_at, ended_at FROM xp_time_sessions
        WHERE user_id = ? AND ended_at > ? AND started_at < ?`,
      [userId, startedIso, endedIso],
    );
    let overlapMs = 0;
    for (const other of overlaps) {
      const from = Math.max(started, Date.parse(other.started_at));
      const to = Math.min(ended, Date.parse(other.ended_at));
      if (to > from) overlapMs += to - from;
    }
    const effective = Math.max(0, duration - Math.ceil(overlapMs / 1000));
    await db.run(
      `INSERT OR IGNORE INTO xp_time_sessions
        (user_id, session_id, started_at, ended_at, declared_seconds, effective_seconds,
         base_consumed_seconds, blocks, granted_xp, processed, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?)`,
      [userId, sessionId, startedIso, endedIso, duration, effective, Number(settings.consumed_seconds || 0), iso(now)],
    );
    row = await db.first(
      'SELECT * FROM xp_time_sessions WHERE user_id = ? AND session_id = ?',
      [userId, sessionId],
    );
  }

  if (Number(row.processed) === 1) {
    const config = await readSettings(db, userId);
    return {
      added: false, duplicate: true,
      blocks: Number(row.blocks),
      grantedXP: Number(row.granted_xp),
      effectiveSeconds: Number(row.effective_seconds),
      carrySeconds: Number(config?.consumed_seconds || 0) % TIME_BLOCK_SECONDS,
      dailyTimeXP: (await xpSummary(db, userId, config, now)).dailyTimeXP,
      discardedBlocks: 0,
    };
  }

  const base = Number(row.base_consumed_seconds || 0);
  const effective = Number(row.effective_seconds);
  const totalSeconds = base + effective;
  const existingBlocks = Math.floor(base / TIME_BLOCK_SECONDS);
  const totalBlocks = Math.floor(totalSeconds / TIME_BLOCK_SECONDS);
  const blocks = totalBlocks - existingBlocks;
  const newConsumed = base + blocks * TIME_BLOCK_SECONDS;
  const day = localDay(settings.time_zone, new Date(now));
  const today = await db.first(
    `SELECT COALESCE(SUM(xp), 0) AS xp FROM xp_events
      WHERE user_id = ? AND kind = 'time_block' AND local_day = ?`,
    [userId, day],
  );
  const already = Number(today?.xp || 0);
  const allowedBlocks = Math.max(0, Math.floor((DAILY_TIME_XP_CAP - already) / TIME_BLOCK_XP));
  const rewardedBlocks = Math.min(blocks, allowedBlocks);
  const discardedBlocks = blocks - rewardedBlocks;

  let materialTitle = 'Bloco de estudo';
  if (input.courseId) {
    try {
      const state = await loadState(db, userId);
      const course = findCourse(state, input.courseId);
      if (course) materialTitle = `Bloco de estudo — ${course.title}`;
    } catch { /* A sessão continua válida sem o título do material. */ }
  }

  for (let index = 0; index < rewardedBlocks; index += 1) {
    await insertEvent(db, userId, {
      key: timeEventKey(sessionId, index),
      kind: 'time_block',
      xp: TIME_BLOCK_XP,
      materialId: typeof input.courseId === 'string' ? input.courseId : '',
      materialTitle,
      sessionId,
      origin: 'manual',
      day,
      at: iso(now),
    });
  }

  await db.run(
    `UPDATE xp_settings
        SET consumed_seconds = CASE WHEN consumed_seconds < ? THEN ? ELSE consumed_seconds END,
            updated_at = ?
      WHERE user_id = ?`,
    [newConsumed, newConsumed, iso(now), userId],
  );
  await db.run(
    `UPDATE xp_time_sessions
        SET blocks = ?, granted_xp = ?, processed = 1
      WHERE user_id = ? AND session_id = ?`,
    [blocks, rewardedBlocks * TIME_BLOCK_XP, userId, sessionId],
  );

  const config = await readSettings(db, userId);
  return {
    added: rewardedBlocks > 0,
    duplicate: false,
    blocks,
    rewardedBlocks,
    discardedBlocks,
    grantedXP: rewardedBlocks * TIME_BLOCK_XP,
    effectiveSeconds: effective,
    carrySeconds: Number(config?.consumed_seconds || 0) % TIME_BLOCK_SECONDS,
    dailyTimeXP: already + rewardedBlocks * TIME_BLOCK_XP,
  };
}

export async function updateXpSettings(db, userId, input, { now = Date.now() } = {}) {
  const current = await ensureXpSettings(db, userId, { now });
  const nextOptIn = typeof input?.rankingOptIn === 'boolean'
    ? input.rankingOptIn
    : Number(current.ranking_opt_in) === 1;
  const zone = input?.timeZone === undefined ? current.time_zone : normalizeTimeZone(input.timeZone);
  await db.run(
    'UPDATE xp_settings SET ranking_opt_in = ?, time_zone = ?, updated_at = ? WHERE user_id = ?',
    [nextOptIn ? 1 : 0, zone, iso(now), userId],
  );
  return serializeSettings(await readSettings(db, userId));
}

function placeholders(count) {
  return Array.from({ length: count }, () => '?').join(', ');
}

function compareFor(tab) {
  if (tab === 'courses') return (entry) => [entry.coursesCompleted, entry.level];
  if (tab === 'effort') return (entry) => [entry.periodXP, entry.minutes];
  return (entry) => [entry.level, entry.totalXP];
}

function rankEntries(entries, tab) {
  const valueOf = compareFor(tab);
  const sorted = [...entries].sort((left, right) => {
    const a = valueOf(left);
    const b = valueOf(right);
    for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
      if ((b[index] || 0) !== (a[index] || 0)) return (b[index] || 0) - (a[index] || 0);
    }
    return left.name.localeCompare(right.name, 'pt-BR');
  });
  let last = null;
  let position = 0;
  return sorted.map((entry, index) => {
    const key = JSON.stringify(valueOf(entry));
    if (key !== last) {
      position = index + 1;
      last = key;
    }
    return { ...entry, position };
  });
}

export async function getRanking(db, userId, { tab = 'level', period = 'week', timeZone = '', now = Date.now() } = {}) {
  const settings = await ensureXpSettings(db, userId, { now, timeZone, updateTimeZone: Boolean(timeZone) });
  const zone = normalizeTimeZone(timeZone || settings.time_zone);
  const range = periodDays(period === 'month' ? 'month' : 'week', zone, new Date(now));
  const friends = await db.all('SELECT friend_id AS id FROM friendships WHERE user_id = ?', [userId]);
  const ids = [userId, ...friends.map((row) => row.id)];
  const configs = await db.all(
    `SELECT user_id, ranking_opt_in FROM xp_settings WHERE user_id IN (${placeholders(ids.length)})`,
    ids,
  );
  const configMap = new Map(configs.map((row) => [row.user_id, Number(row.ranking_opt_in) === 1]));
  const optedIds = ids.filter((id) => configMap.get(id) === true);

  const totalRows = await db.all(
    `SELECT user_id,
            COALESCE(SUM(xp), 0) AS total_xp,
            COALESCE(SUM(CASE WHEN kind = 'course_bonus' THEN 1 ELSE 0 END), 0) AS courses,
            COALESCE(SUM(CASE WHEN kind = 'project_bonus' THEN 1 ELSE 0 END), 0) AS projects
       FROM xp_events WHERE user_id IN (${placeholders(ids.length)})
      GROUP BY user_id`,
    ids,
  );
  const totals = new Map(totalRows.map((row) => [row.user_id, row]));

  const names = await db.all(
    `SELECT id, name FROM users WHERE id IN (${placeholders(ids.length)})`,
    ids,
  );
  const nameMap = new Map(names.map((row) => [row.id, row.name]));

  const periodEvents = await db.all(
    `SELECT user_id, kind, xp, granted_at, session_id FROM xp_events
      WHERE user_id IN (${placeholders(ids.length)})
        AND granted_at >= ? AND granted_at < ?`,
    [...ids, new Date(range.startUtc).toISOString(), new Date(range.endUtc).toISOString()],
  );
  const timeRows = await db.all(
    `SELECT user_id, COALESCE(SUM(effective_seconds), 0) AS seconds
       FROM xp_time_sessions
      WHERE user_id IN (${placeholders(ids.length)})
        AND ended_at >= ? AND ended_at < ?
      GROUP BY user_id`,
    [...ids, new Date(range.startUtc).toISOString(), new Date(range.endUtc).toISOString()],
  );
  const timeMap = new Map(timeRows.map((row) => [row.user_id, Number(row.seconds || 0)]));

  function buildEntry(id) {
    const total = totals.get(id) || {};
    const level = levelProgress(Number(total.total_xp || 0));
    const events = periodEvents.filter((event) => event.user_id === id);
    return {
      id,
      name: nameMap.get(id) || 'Pessoa do Lume',
      isSelf: id === userId,
      level: level.level,
      levelCurrent: level.current,
      levelNext: level.next,
      totalXP: level.total,
      coursesCompleted: Number(total.courses || 0),
      projectsCompleted: Number(total.projects || 0),
      periodXP: events.reduce((sum, event) => sum + Number(event.xp || 0), 0),
      minutes: Math.round((timeMap.get(id) || 0) / 60),
      lessons: events.filter((event) => event.kind === 'lesson').length,
      readings: events.filter((event) => event.kind === 'reading').length,
      exercises: events.filter((event) => event.kind === 'exercise').length,
      deliveries: events.filter((event) => event.kind === 'delivery').length,
      optedIn: true,
    };
  }

  const selfOptedIn = configMap.get(userId) === true;
  const entries = rankEntries(optedIds.map(buildEntry), tab);
  const selfEntry = selfOptedIn ? entries.find((entry) => entry.isSelf) : { ...buildEntry(userId), optedIn: false, position: null };
  return {
    tab: ['level', 'courses', 'effort'].includes(tab) ? tab : 'level',
    period: {
      kind: range.kind,
      startDay: range.startDay,
      endDay: range.endDay,
      timeZone: zone,
    },
    policy: xpPolicy(),
    self: selfEntry,
    entries,
    friendsCount: friends.length,
    participantsCount: entries.length,
    legacyExcluded: true,
  };
}
