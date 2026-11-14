// O que a pessoa está estudando agora, para o status do aplicativo de desktop
// (Discord). Visão derivada: lê o estado e o diálogo aberto, não grava nada e
// não gera XP. Só nomes que a pessoa já vê na tela saem daqui; o aplicativo
// decide se mostra (o interruptor "Ocultar do Discord" vale sempre).

import { materialSteps } from './material-model.js';
import { nextAction } from './study-plan.js';
import { sessionElapsed } from './session-domain.js';

const TEXT_MAX = 120;

function clip(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, TEXT_MAX);
}

function lessonOf(state, course, stepId) {
  const steps = materialSteps(course);
  let index = steps.findIndex((step) => step.id === stepId);
  if (index < 0) {
    // Sem aula indicada, o diálogo abre a próxima; o status acompanha.
    const next = nextAction({ ...state, courses: [course] });
    index = next ? steps.findIndex((step) => step.id === next.lessonId) : -1;
  }
  if (index < 0) return null;
  return { title: clip(steps[index].title), number: index + 1, total: steps.length };
}

// Material aberto no diálogo: aula (`session`) ou PDF (`pdf`/`session` de PDF).
function openMaterial(state, modal) {
  if (!modal || !['session', 'pdf'].includes(modal.type)) return null;
  const course = (state.courses || []).find((item) => item.id === modal.id);
  if (!course) return null;
  if (course.pdf) {
    const pages = Number(course.pdf.pages);
    const page = Number(course.reading?.page);
    return {
      kind: 'pdf',
      course: clip(course.title),
      page: Number.isInteger(page) && page > 0 ? page : 1,
      pages: Number.isInteger(pages) && pages > 0 ? pages : 0,
    };
  }
  if (modal.type !== 'session') return null;
  const lesson = lessonOf(state, course, modal.stepId);
  return {
    kind: 'lesson',
    course: clip(course.title),
    lesson: lesson?.title || '',
    number: lesson?.number || 0,
    total: lesson?.total || 0,
  };
}

// `null` quando não há estudo em curso: o aplicativo volta ao roteiro.
export function studyActivity(state, { modal = null, now = Date.now() } = {}) {
  const material = openMaterial(state, modal);
  const session = state.activeSession;
  if (!session) return material;
  const course = (state.courses || []).find((item) => item.id === session.courseId);
  return {
    ...(material || {}),
    kind: material ? material.kind : 'focus',
    course: material?.course || clip(course?.title),
    focus: {
      label: clip(session.label),
      paused: session.status !== 'active',
      elapsedMs: Math.max(0, Math.round(sessionElapsed(session, now))),
    },
  };
}
