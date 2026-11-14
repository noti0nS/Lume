// Tela Início (#hoje) na identidade Norte: saudação direta, "você parou aqui"
// com a constelação do módulo atual, o que vem aí em contagem regressiva, a
// lista do dia, a semana em pontos de luz e os amigos ativos. Tudo derivado do
// estado real; sem dados, ficam os estados vazios.

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { studyRhythm, hasPreparation } from '../../../public/domain.js';
import { materialLesson } from '../../../public/material-model.js';
import { nextAction } from '../../../public/study-plan.js';
import { focusedTask, isOverdue, priorityLabel, taskAgenda } from '../../../public/tasks-domain.js';
import { formatMinutes, localDay } from '../../../public/session-domain.js';
import { WEEKDAYS, daysUntil, moduleTrail, shortDate, trailWindow, upcomingDeadlines, weekLights } from '../../../public/home-domain.js';
import { XP_VALUES, completionKindForCourse, isEligibleCourse } from '../../../public/xp-policy.js';
import { materialStanding, subjectOf } from '../../../public/subject-domain.js';
import { readingLabel } from '../../../public/pdf-domain.js';
import { overdueMessage } from '../plan/Tasks.jsx';
import { useResource } from '../../lib/resources.js';
import Icon from '../../ui/Icon.jsx';
import { Button, Progress, Skeleton, STAR_PATH, Star } from '../../ui/ui.jsx';
import { warmProfileProps } from '../social/prefetch.js';

function plural(count, one, many) {
  return `${count} ${count === 1 ? one : many}`;
}

function useWidth(fallback) {
  const ref = useRef(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(200, Math.round(entry.contentRect.width))));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

// Altura relativa de cada ponto: fixa pela posição da aula, para a forma não mudar ao avançar.
const HEIGHTS = [0.72, 0.44, 0.64, 0.26, 0.56, 0.3, 0.58, 0.22, 0.5, 0.36, 0.68];

// Constelação do módulo: concluídas = pontos azul-claros ligados por linha,
// atual = estrela dourada, futuras = pontos vazados com linha tracejada.
function Constellation({ trail, label }) {
  const [ref, width] = useWidth(640);
  const narrow = width < 440;
  const height = narrow ? 64 : 96;
  const radius = narrow ? 5 : 6;
  const star = narrow ? 30 : 42;
  const visible = trailWindow(trail.nodes, trail.current, narrow ? 7 : 11);
  const pad = star / 2;
  const step = visible.length > 1 ? (width - pad * 2) / (visible.length - 1) : 0;
  const points = visible.map((node, index) => ({
    ...node,
    x: visible.length > 1 ? pad + step * index : width / 2,
    y: pad + (height - pad * 2) * HEIGHTS[node.index % HEIGHTS.length],
  }));
  const currentAt = points.findIndex((point) => point.state === 'current');
  const line = (list) => list.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');
  const walked = currentAt >= 0 ? points.slice(0, currentAt + 1) : [];
  const ahead = currentAt >= 0 ? points.slice(currentAt) : points;
  return <div ref={ref} className="constellation">
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} role="img" aria-label={label}>
      {walked.length > 1 && <polyline points={line(walked)} className="constellation-walked"/>}
      {ahead.length > 1 && <polyline points={line(ahead)} className="constellation-ahead"/>}
      {points.map((point) => point.state === 'current'
        ? <path key={point.id} d={STAR_PATH} className="constellation-star" transform={`translate(${(point.x - star / 2).toFixed(1)} ${(point.y - star / 2).toFixed(1)}) scale(${star / 24})`}/>
        : <circle key={point.id} cx={point.x.toFixed(1)} cy={point.y.toFixed(1)} r={radius} className={point.state === 'done' ? 'constellation-done' : 'constellation-todo'}/>)}
    </svg>
  </div>;
}

function headlineFor({ focus, action, trail, unit }) {
  if (focus) return `Seu foco agora: ${focus.title}.`;
  if (action?.pdf) {
    return action.pdf.started
      ? `Você está na página ${action.pdf.page} de ${action.pdf.pages}.`
      : `${plural(action.pdf.pages, 'página', 'páginas')} pra ler em ${action.courseTitle}.`;
  }
  if (action) {
    const remaining = trail?.module ? trail.remaining : action.remaining;
    const what = trail?.module ? 'o módulo' : 'o material';
    return remaining === 1 ? `Falta 1 ${unit} pra fechar ${what}.` : `Faltam ${remaining} ${unit}s pra fechar ${what}.`;
  }
  return 'Adicione um material e a próxima aula aparece aqui.';
}

export function Home({ state, open, go, planActions, notify, account }) {
  const action = nextAction(state);
  const plan = studyRhythm(state);
  const agenda = taskAgenda(state);
  const unit = action?.imported ? 'aula' : 'etapa';
  const prepare = action && !action.imported && plan.prepareFirst && !hasPreparation(state, action.lessonId);
  const course = action ? state.courses.find((item) => item.id === action.courseId) : null;
  const focus = focusedTask(state);
  const focusCourse = focus?.courseId ? state.courses.find((item) => item.id === focus.courseId) : null;
  const focusLesson = focusCourse && focus.lessonId ? materialLesson(focusCourse, focus.lessonId) : null;
  const trail = action && !action.pdf ? moduleTrail(state, action) : null;
  const gamified = state.preferences?.gamification !== false;
  const reward = gamified && course && isEligibleCourse(course) ? XP_VALUES[completionKindForCourse(course)] : 0;

  function completeTask(task) {
    const now = new Date().toISOString();
    const result = planActions.completeTask(task.id, now);
    if (!result?.added) return;
    notify(`Tarefa concluída: ${task.title}.${task.lessonId ? ' A conclusão da aula vinculada foi registrada.' : ''}`);
  }

  function toggleFocus(task) {
    if (focus?.id === task.id) {
      if (planActions.clearTaskFocus()) notify(`${task.title} saiu do foco. O Início volta a sugerir pelo roteiro.`);
      return;
    }
    if (planActions.focusTask(task.id)) notify(`Foco agora: ${task.title}.`);
  }

  const today = localDay();
  const firstName = (account?.name || '').split(' ')[0];
  const hour = new Date().getHours();
  const greeting = hour < 5 ? 'Boa noite' : hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
  const pdfPercent = action?.pdf ? materialStanding(state, course).percent : 0;
  const subject = course ? subjectOf(state, course) : null;
  const trailLabel = trail
    ? `${trail.module || action.courseTitle}: ${plural(trail.done, `${unit} concluída`, `${unit}s concluídas`)} de ${trail.nodes.length}; a atual é ${action.title}.`
    : '';
  const focusButton = (primary = false) => <Button secondary={!primary} onClick={() => go('foco')}><Icon name="timer"/>Sessão de foco</Button>;

  return <div className="study-root today-root">
    <section className="today-welcome" aria-labelledby="today-title">
      <h1 id="today-title" className="sr-only">Início</h1>
      <div className="today-date">
        <span>{shortDate(today)}</span>
        <button type="button" className="today-rhythm" onClick={() => go('inicio')} title="Ajustar seu ritmo">ritmo: {plan.title.toLowerCase()}</button>
      </div>
      <p className="today-greeting">{greeting}{firstName ? `, ${firstName}` : ''}.<span>{headlineFor({ focus, action, trail, unit })}</span></p>
    </section>

    <div className="today-layout">
      <div className="today-main">
        <section className={`card-surface next-action today-resume ${focus ? 'is-focus' : ''}`} aria-labelledby="next-title">
          {focus ? <>
            <div className="today-resume-top">
              <span className="today-resume-label">Foco agora · escolhido por você</span>
              <span className="today-resume-meta">{taskMeta(focus)}</span>
            </div>
            <h2 id="next-title" className="today-resume-title">{focus.title}</h2>
            {action && <p className="today-resume-sub">Roteiro: próxima {unit} é <strong>{action.title}</strong> ({action.courseTitle}).</p>}
            <div className="next-linked-material">
              <span className="next-linked-icon"><Icon name="book"/></span>
              <div className="next-linked-copy">
                <strong>{focusCourse ? focusCourse.title : 'Sem curso vinculado.'}</strong>
                <small>{focusLesson ? `Aula vinculada: ${focusLesson.title}` : focus.subtasks?.length ? `${focus.subtasks.filter((item) => item.done).length} de ${focus.subtasks.length} subtarefas concluídas` : 'Estude pelo seu material e marque ao finalizar'}</small>
              </div>
            </div>
            <div className="action-row">
              {focusButton(true)}
              {focusLesson && <Button secondary onClick={() => open({ type: 'session', id: focusCourse.id, stepId: focusLesson.id })}><Icon name="check"/>Abrir a aula</Button>}
              <Button secondary onClick={() => completeTask(focus)}><Icon name="check"/>Concluir tarefa</Button>
              {focusCourse && <Button ghost onClick={() => open({ type: 'course', id: focusCourse.id })}>Abrir na biblioteca</Button>}
              <Button ghost onClick={() => toggleFocus(focus)}>Tirar do foco</Button>
            </div>
          </> : action?.pdf ? <>
            <div className="today-resume-top">
              <span className="today-resume-label">você parou aqui</span>
              <span className="today-resume-meta">{action.pdf.started ? `p. ${action.pdf.page}/${action.pdf.pages}` : `${action.pdf.pages} p.`} · {action.minutes} min · estimativa</span>
            </div>
            <h2 id="next-title" className="today-resume-title">{action.pdf.started ? `Continuar ${action.courseTitle} na página ${action.pdf.page}` : `Começar ${action.courseTitle}`}</h2>
            <p className="today-resume-sub">{[subject?.title, action.pdf.started ? readingLabel(course.reading, action.pdf.pages) : 'Leitura em PDF · ainda não aberto', action.pdf.section].filter(Boolean).join(' · ')}</p>
            <div className="today-reading">
              <Progress value={pdfPercent} max={100} tone="mint" label={`Avanço em ${action.courseTitle}`}/>
              <span>{pdfPercent}% lido</span>
            </div>
            <p className="today-reason"><strong>{action.reason.label}.</strong> {action.reason.detail}</p>
            <div className="action-row">
              <Button onClick={() => open({ type: 'pdf', id: action.courseId })}><Icon name="book"/>{action.pdf.started ? `Continuar na p. ${action.pdf.page}` : 'Abrir no leitor'}</Button>
              {focusButton()}
              <Button ghost onClick={() => open({ type: 'course', id: action.courseId })}>Abrir na biblioteca</Button>
              {reward > 0 && <span className="today-reward">+{reward} xp ao concluir a leitura</span>}
            </div>
          </> : action ? <>
            <div className="today-resume-top">
              <span className="today-resume-label">você parou aqui</span>
              <span className="today-resume-meta">{unit} {trail.position}/{trail.total} · {action.minutes} min{action.durationKnown ? '' : ' · estimativa'}</span>
            </div>
            <h2 id="next-title" className="today-resume-title">{action.title}</h2>
            <p className="today-resume-sub">{[action.courseTitle, trail.module].filter(Boolean).join(' · ')}</p>
            <Constellation trail={trail} label={trailLabel}/>
            <p className="today-reason"><strong>{action.reason.label}.</strong> {action.reason.detail}{action.partial ? ' Grade parcial.' : ''}</p>
            <div className="action-row">
              {prepare
                ? <Button onClick={() => open({ type: 'session', id: action.courseId, preparation: true })}><Icon name="book"/>Preparar o material</Button>
                : <Button onClick={() => open({ type: 'session', id: action.courseId, stepId: action.lessonId })}><Icon name="play"/>Continuar {unit} {trail.position}</Button>}
              {focusButton()}
              {!action.imported && <Button ghost onClick={() => open({ type: 'session', id: action.courseId, preparation: !prepare })}>{prepare ? 'Ir direto à etapa' : 'Dividir em um passo menor'}</Button>}
              <Button ghost onClick={() => open({ type: 'course', id: action.courseId })}>Abrir na biblioteca</Button>
              {reward > 0 && <span className="today-reward">+{reward} xp ao concluir</span>}
            </div>
          </> : <>
            <div className="today-resume-top">
              <span className="today-resume-label">comece por aqui</span>
            </div>
            <h2 id="next-title" className="today-resume-title">Nenhum material em andamento.</h2>
            <p className="today-resume-sub">Importe um curso por link, anexe um PDF ou crie um material. A próxima aula aparece aqui com o tempo sugerido.</p>
            <div className="action-row">
              <Button onClick={() => go('biblioteca')}><Icon name="plus"/>Ir para a biblioteca</Button>
              {focusButton()}
            </div>
          </>}
        </section>

        <Upcoming state={state} today={today}/>

        <section className="card-surface today-tasks" aria-labelledby="today-tasks-title">
          <div className="today-card-head">
            <h2 id="today-tasks-title" className="title">Plano do dia <span className="today-count">{agenda.pending}</span></h2>
            <a className="text-link" href="#tarefas">Abrir lista</a>
          </div>
          {agenda.overdue > 0 && <p className="inline-note todo-overdue-note" role="status"><Icon name="flag"/><span>{overdueMessage(agenda.overdue)}</span></p>}
          {agenda.next.length
            ? <ul className="today-task-list">{agenda.next.map((task) => {
              const late = isOverdue(task);
              return <li key={task.id} className={`todo-item ${focus?.id === task.id ? 'is-focus' : ''}`}>
                <button
                  type="button"
                  aria-pressed={focus?.id === task.id}
                  title={focus?.id === task.id ? 'Tirar do foco' : 'Focar no Início'}
                  aria-label={focus?.id === task.id ? `Tirar ${task.title} do foco` : `Focar em ${task.title} no Início`}
                  className="todo-focus"
                  onClick={() => toggleFocus(task)}
                >
                  <Icon name="focus"/>
                </button>
                <span className="todo-copy">
                  <strong>{task.title}</strong>
                  <small className="todo-meta">{focus?.id === task.id ? 'em foco · ' : ''}{task.dueDate ? shortDate(task.dueDate) : 'sem prazo'}</small>
                </span>
                <span className="today-task-right">
                  {(late || task.priority > 0) && <span className={`task-priority ${late ? 'p-late' : `p-${task.priority}`}`}>{late ? 'Atrasada' : priorityLabel(task.priority)}</span>}
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked="false"
                    title="Concluir"
                    aria-label={`Concluir tarefa ${task.title}`}
                    className="todo-check today-task-done"
                    onClick={() => completeTask(task)}
                  >
                    <Icon name="check"/>
                  </button>
                </span>
              </li>;
            })}</ul>
            : <p className="muted-text">Sem tarefas pendentes. Defina o próximo passo em <a className="text-link" href="#tarefas">Tarefas</a> ou agende um bloco.</p>}
          {agenda.pending > agenda.next.length && <a className="text-link today-foot-link" href="#tarefas">Mais {plural(agenda.pending - agenda.next.length, 'tarefa', 'tarefas')}<Icon name="arrow"/></a>}
        </section>
      </div>

      <aside className="today-side" aria-label="Semana">
        <WeekLights state={state} today={today}/>
      </aside>
    </div>
    <ActiveRail account={account} go={go}/>
  </div>;
}

function Upcoming({ state, today }) {
  const { items, total, session } = upcomingDeadlines(state, today);
  return <section className="today-upcoming" aria-labelledby="upcoming-title">
    <div className="today-card-head">
      <h2 id="upcoming-title" className="title">O que vem aí</h2>
      <a className="text-link" href="#agenda">Abrir calendário</a>
    </div>
    {items.length
      ? <ul className="countdown-list">{items.map((item, index) => {
        const days = daysUntil(item.date, today);
        return <li key={item.id}>
          <a className={`countdown ${index === 0 ? 'is-next' : ''}`} href={item.href}>
            <span className="countdown-number" aria-hidden="true">{days}</span>
            <span className="countdown-copy">
              <span className="countdown-when">{days === 0 ? 'é hoje' : days === 1 ? 'dia' : 'dias'} · {shortDate(item.date)}{item.start ? ` · ${item.start}` : ''}</span>
              <strong>{item.title}</strong>
              <span className="sr-only">{item.kind}, {days === 0 ? 'hoje' : days === 1 ? 'amanhã' : `em ${days} dias`}</span>
            </span>
          </a>
        </li>;
      })}</ul>
      : <p className="muted-text today-upcoming-empty">Nenhuma prova, entrega ou prazo marcado. <a className="text-link" href="#agenda">Marcar no calendário</a></p>}
    <p className="today-upcoming-foot">
      {session
        ? <>próxima sessão · <a className="text-link" href={`#agenda?data=${encodeURIComponent(session.date)}`}>{shortDate(session.date)}{session.start ? ` ${session.start}` : ''} · {session.title}</a></>
        : <a className="text-link" href="#agendar">Agendar uma sessão de estudo</a>}
      {total > items.length && <span> · mais {total - items.length} no calendário</span>}
    </p>
  </section>;
}

function WeekLights({ state }) {
  const week = weekLights(state);
  return <section className="card-surface week-lights" aria-labelledby="week-title">
    <div className="today-card-head">
      <h2 id="week-title" className="title">Sua semana</h2>
      <span className="week-total">{formatMinutes(week.total)}</span>
    </div>
    <ol className="week-dots" aria-label={`Minutos de estudo nesta semana: ${week.days.filter((day) => day.state !== 'future').map((day) => `${WEEKDAYS[new Date(`${day.date}T12:00:00`).getDay()]} ${day.minutes}`).join(', ')}`}>
      {week.days.map((day) => {
        const label = day.state === 'today' ? 'hoje' : WEEKDAYS[new Date(`${day.date}T12:00:00`).getDay()];
        return <li key={day.date} className={`week-day is-${day.state}`} title={day.state === 'future' ? label : `${label}: ${formatMinutes(day.minutes)}`}>
          {day.state === 'today' ? <Star size={20}/> : <span className="week-dot" aria-hidden="true"/>}
          <span>{label}</span>
        </li>;
      })}
    </ol>
    <p className="week-note">{week.lit ? `${plural(week.lit, 'dia aceso', 'dias acesos')} nesta semana.` : 'Nenhum dia aceso ainda nesta semana.'}</p>
  </section>;
}

// Barra lateral "Ativos agora": amigos com presença recente (sessão de foco aberta,
// aplicativo de desktop ou site aberto) e a matéria que estudam, quando compartilham.
// Em telas largas fica fixa na borda direita, em altura total, abaixo do cabeçalho;
// em telas estreitas vira uma seção comum no fim da página.
const RAIL_QUERY = '(min-width: 1200px)';

function useWideRail() {
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && window.matchMedia(RAIL_QUERY).matches);
  useEffect(() => {
    const query = window.matchMedia(RAIL_QUERY);
    const update = () => setWide(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return wide;
}

function ActiveRail({ account, go }) {
  const wide = useWideRail();
  const resource = useResource('/api/friends', { interval: 45000, enabled: Boolean(account) });
  const friends = resource.data?.friends || [];
  const activeFriends = friends
    .filter((friend) => friend.activity?.active)
    .sort((a, b) => Number(b.activity?.status === 'studying') - Number(a.activity?.status === 'studying') || a.name.localeCompare(b.name, 'pt-BR'));

  useEffect(() => {
    if (!wide) return undefined;
    document.documentElement.classList.add('has-active-rail');
    return () => document.documentElement.classList.remove('has-active-rail');
  }, [wide]);

  const rail = <aside className="active-rail" aria-labelledby="active-rail-title">
    <h2 id="active-rail-title" className="active-rail-title">Ativos agora</h2>
    {!account
      ? <p className="muted-text active-rail-empty">Amigos, mensagens e ranking ficam disponíveis com uma conta.</p>
      : !resource.data
        ? <Skeleton label="Carregando amigos…" rows={2}/>
        : activeFriends.length
          ? <ul className="active-rail-list">{activeFriends.map((friend) => {
            const activity = friend.activity || { status: 'online', label: 'Online', topic: '' };
            const studying = activity.status === 'studying';
            return <li key={friend.id} className={`active-card ${studying ? 'is-studying' : ''}`}>
              <div className="active-card-head">
                <a className="active-card-who" {...warmProfileProps(friend)} href={`#perfil?id=${encodeURIComponent(friend.id)}`} onClick={friend.handle ? (event) => { event.preventDefault(); go(`perfil?u=${friend.handle}`); } : undefined}>
                  <span className="avatar active-avatar" aria-hidden="true">
                    {String(friend.name || '?').slice(0, 1).toUpperCase()}
                    <span className="active-presence" />
                  </span>
                  <span className="active-copy">
                    <strong>{friend.name}</strong>
                    <span className="active-status">{activity.label}</span>
                  </span>
                </a>
                <a className="active-msg" href={`#mensagens?com=${encodeURIComponent(friend.id)}`} aria-label={`Mensagem para ${friend.name}`} title={`Mensagem para ${friend.name}`}>
                  <Icon name="message"/>
                </a>
              </div>
              {studying && <div className="active-card-body">
                <span className="active-tile" aria-hidden="true"><Icon name="book"/></span>
                <span className="active-copy">
                  <strong>{activity.topic || 'Sessão de estudo'}</strong>
                  <span className="active-status">estudando agora</span>
                </span>
              </div>}
            </li>;
          })}</ul>
          : <p className="muted-text active-rail-empty">{friends.length ? 'Nenhum amigo ativo agora.' : 'Estudar junto é opcional. Um convite começa a lista.'}</p>}
  </aside>;

  return wide ? createPortal(rail, document.body) : rail;
}

function taskMeta(task) {
  const late = isOverdue(task);
  return [
    task.priority > 0 ? `prioridade ${priorityLabel(task.priority).toLowerCase()}` : '',
    late ? 'atrasada' : '',
    task.dueDate ? `${late ? 'venceu' : 'vence'} ${shortDate(task.dueDate)}` : 'sem prazo',
  ].filter(Boolean).join(' · ');
}
