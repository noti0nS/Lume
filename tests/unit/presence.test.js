import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState } from '../../public/domain.js';
import { unitsFromStructure } from '../../public/material-model.js';
import { startSession, pauseSession } from '../../public/session-domain.js';
import { studyActivity } from '../../public/presence-domain.js';
import { buildDiscordActivity, normalizeStudy } from '../../companion/discord-presence.mjs';

function stateWith(course) {
  return { ...createInitialState(), courses: [course] };
}

const lessons = Array.from({ length: 12 }, (_, i) => ({ id: `l${i + 1}`, title: `Aula ${i + 1} do tema` }));
const falencia = {
  id: 'fal', title: 'Falência', type: 'course', planning: false, example: false, paused: false, art: 'design', url: '',
  units: unitsFromStructure([{ id: 'd', title: 'D', modules: [{ id: 'm', title: 'M', lessons }] }], lessons.map((l) => l.id)),
};

test('aula aberta vira "Estudando <curso>" com o número da aula', () => {
  const state = stateWith(falencia);
  const study = studyActivity(state, { modal: { type: 'session', id: 'fal', stepId: 'l9' } });
  assert.equal(study.kind, 'lesson');
  assert.equal(study.number, 9);
  assert.equal(study.total, 12);
  const { activity } = buildDiscordActivity({ study: normalizeStudy(study), startedAt: 1_000_000 });
  assert.equal(activity.details, 'Estudando Falência');
  assert.equal(activity.state, 'Aula 9 · Aula 9 do tema');
  assert.equal(activity.startTimestamp, 1_000_000);
});

test('sem material nem sessão, não há atividade (volta ao roteiro)', () => {
  assert.equal(studyActivity(stateWith(falencia), { modal: null }), null);
  assert.equal(studyActivity(stateWith(falencia), { modal: { type: 'course', id: 'fal' } }), null);
});

test('PDF aberto mostra a página', () => {
  const pdf = { id: 'pdf1', title: 'Apostila de Direito', type: 'pdf', units: [], pdf: { pages: 300 }, reading: { page: 12 } };
  const study = studyActivity(stateWith(pdf), { modal: { type: 'pdf', id: 'pdf1' } });
  assert.deepEqual([study.kind, study.page, study.pages], ['pdf', 12, 300]);
  const { activity } = buildDiscordActivity({ study: normalizeStudy(study), startedAt: 5 });
  assert.equal(activity.details, 'Lendo Apostila de Direito');
  assert.equal(activity.state, 'Página 12 de 300');
});

test('sessão de foco ativa usa o tempo já decorrido como relógio; pausada mostra os minutos', () => {
  const t0 = Date.parse('2026-11-14T10:00:00Z');
  let state = startSession(stateWith(falencia), { courseId: 'fal', label: 'Revisar' }, t0);
  const now = t0 + 12 * 60_000;
  const running = studyActivity(state, { now });
  assert.equal(running.kind, 'focus');
  assert.equal(running.focus.elapsedMs, 12 * 60_000);
  const built = buildDiscordActivity({ study: normalizeStudy(running), startedAt: t0 });
  assert.equal(built.activity.details, 'Em foco · Falência');
  assert.equal(built.activity.startTimestamp, t0);

  state = pauseSession(state, now);
  const paused = buildDiscordActivity({ study: normalizeStudy(studyActivity(state, { now })), startedAt: t0 });
  assert.equal(paused.activity.details, 'Foco em pausa · Falência');
  assert.equal(paused.activity.state, '12 min focados');
  assert.equal(paused.activity.startTimestamp, undefined);
});

test('foco com aula aberta junta as duas informações', () => {
  const state = startSession(stateWith(falencia), { courseId: 'fal', label: 'Revisar' }, 1000);
  const study = studyActivity(state, { modal: { type: 'session', id: 'fal', stepId: 'l9' }, now: 2000 });
  const { activity } = buildDiscordActivity({ study: normalizeStudy(study), startedAt: 1000 });
  assert.equal(activity.details, 'Em foco · Falência');
  assert.equal(activity.state, 'Aula 9 · Aula 9 do tema');
});

test('entrada inválida da página é descartada', () => {
  assert.equal(normalizeStudy(null), null);
  assert.equal(normalizeStudy({ kind: 'hack' }), null);
  assert.equal(normalizeStudy({ kind: 'focus' }), null);
  const clipped = normalizeStudy({ kind: 'lesson', course: 'x'.repeat(500), number: -4, total: 'a' });
  assert.ok(clipped.course.length <= 128);
  assert.equal(clipped.number, 0);
});
