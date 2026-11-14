import { Activity, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useLume } from './useLume.js';
import Shell from './Shell.jsx';
import { Dialog, PageSkeleton, enter, ease } from '../ui/ui.jsx';
import { ENTRY_ROUTES, PUBLIC_ROUTES, ROUTE_BY_ID, SessionCheck, parseHash, routeHash } from './routes.jsx';
import { ModalContent } from './modals.jsx';
import Icon from '../ui/Icon.jsx';
import { isDesktopApp, markDesktop, reportStudy, syncTitleBar } from '../lib/desktop.js';
import { studyActivity } from '../../public/presence-domain.js';
import { listenForExtension } from '../lib/extension.js';
import { findLessonByUrl } from '../../public/import-domain.js';
import Reminders from '../features/agenda/Reminders.jsx';
import MessageAlert from '../features/social/MessageAlert.jsx';

// Marca o documento antes do primeiro desenho: no app, a barra de título ocupa
// o topo; no navegador, nada muda.
markDesktop();

export default function App() {
  const [hash, setHash] = useState(() => routeHash());
  const [toast, setToast] = useState(null);
  const [modal, setModal] = useState(null);
  const [authMode, setAuthMode] = useState('login');
  const toastTimer = useRef(null);
  const stateRef = useRef(null);
  // `action` oferece um botão (ex.: Desfazer); a barra mostra quanto tempo ele continua disponível.
  // Escudo de foco silencia avisos não essenciais enquanto uma sessão ativa está em curso.
  const notify = useCallback((message, { action = null, important = false } = {}) => {
    const prefs = stateRef.current?.preferences;
    const active = stateRef.current?.activeSession;
    if (!important && !action && prefs?.focusShield && active && !active.paused) return;
    const duration = action ? 8000 : 6500;
    clearTimeout(toastTimer.current);
    setToast({ message, action, duration, id: Date.now() });
    toastTimer.current = setTimeout(() => setToast(null), duration);
  }, []);
  const model = useLume(notify);
  const { state } = model;
  const { requested, params } = parseHash(hash);
  const signedIn = Boolean(model.account);
  // A sessão verificada vale mais que o hash: #login não pode derrubar quem já entrou.
  const route = PUBLIC_ROUTES.has(requested) ? requested
    : (!signedIn && !model.preview) || (requested === 'login' && !signedIn) ? 'login'
    : !state.onboarded ? 'inicio'
    : requested && requested !== 'login' && ROUTE_BY_ID.has(requested) ? requested : 'hoje';
  const checkingSession = model.accountStatus === 'checking' && !signedIn && !model.preview;
  const previousRoute = useRef(null);
  const go = useCallback(destination => {
    // Perfil pelo @usuário: o endereço vira /@usuario no clique, sem esperar os dados.
    const profile = /^perfil\?u=([A-Za-z0-9._]{3,24})$/.exec(destination);
    if (profile) {
      history.pushState(null, '', `/@${profile[1].toLowerCase()}`);
      setHash(routeHash());
      setModal(null);
      return;
    }
    location.hash = destination;
  }, []);
  // Leitura de curso enviada pela extensão: abre a revisão da importação.
  const captureReady = useRef(false);
  captureReady.current = signedIn || Boolean(model.preview);
  stateRef.current = state;
  useEffect(() => listenForExtension({
    capture: payload => {
      if (!captureReady.current) { notify('Entre na sua conta do Lume e envie a leitura de novo pela extensão.'); return false; }
      setModal({ type: 'import', capture: payload });
      return true;
    },
    // "Concluí esta aula" na página da plataforma: abre a aula certa para a pessoa confirmar.
    complete: payload => {
      if (!captureReady.current) { notify('Entre na sua conta do Lume e tente de novo pela extensão.'); return false; }
      const found = findLessonByUrl(stateRef.current, payload?.url);
      if (!found) { notify('Não encontrei esta aula nos seus cursos. Importe o curso pela extensão antes.'); return 'not_found'; }
      setModal({ type: 'session', id: found.course.id, stepId: found.lesson.id });
      return true;
    },
  }), [notify]);
  useEffect(() => {
    const change = () => {
      // Saindo de /@usuario por um link de hash: o caminho volta para a raiz do app.
      if (location.hash && location.pathname !== '/') history.replaceState(null, '', `/${location.hash}`);
      setHash(routeHash());
      setModal(null);
    };
    window.addEventListener('hashchange', change);
    window.addEventListener('popstate', change);
    return () => { window.removeEventListener('hashchange', change); window.removeEventListener('popstate', change); clearTimeout(toastTimer.current); };
  }, []);
  // #login preso na URL não deve sobreviver a uma sessão válida.
  useLayoutEffect(() => {
    if (!model.account || requested !== 'login') return;
    const destination = state.onboarded ? 'hoje' : 'inicio';
    history.replaceState(null, '', `#${destination}`);
    setHash(`#${destination}`);
  }, [model.account, requested, state.onboarded]);
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = state.preferences.theme;
    // Identidade única: o campo `palette` dos dados antigos não muda mais as cores.
    document.documentElement.removeAttribute('data-palette');
    syncTitleBar(state.preferences.theme);
    document.documentElement.dataset.text = state.preferences.textSize;
    document.documentElement.dataset.page = route;
    document.documentElement.removeAttribute('data-essential');
    document.querySelector('meta[name="theme-color"]').content = state.preferences.theme === 'light' ? '#f4f6fa' : '#0c111b';
    document.title = `${ROUTE_BY_ID.get(route).title} · Lume`;
    if (previousRoute.current && previousRoute.current !== route) {
      document.querySelector('#main')?.focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: 'instant' });
    }
    previousRoute.current = route;
  }, [route, state.preferences.theme, state.preferences.textSize]);
  // Status do Discord no aplicativo: aula ou PDF aberto e sessão de foco. A página
  // renova a cada 20 s; se ela parar, o aplicativo volta ao roteiro sozinho.
  const modalRef = useRef(null);
  modalRef.current = modal;
  useEffect(() => {
    if (!isDesktopApp()) return undefined;
    const send = () => reportStudy(studyActivity(stateRef.current, { modal: modalRef.current }));
    send();
    const beat = setInterval(send, 20000);
    return () => clearInterval(beat);
  }, [modal, state.activeSession, state.courses]);
  useEffect(() => () => reportStudy(null), []);
  const open = useCallback(value => setModal(value), []);
  const close = useCallback(() => setModal(null), []);
  async function exit() {
    try { await model.exit(); go('login'); notify('Você saiu. Seu progresso foi preservado.'); }
    catch { notify('Não foi possível sair da conta agora. Tente novamente.'); }
  }
  const current = ROUTE_BY_ID.get(route);
  const routeContext = { model, state, open, go, notify, params, hash, authMode, setAuthMode, checkingSession, onExit: exit };
  // Com conta, a biblioteca chega do servidor: até lá, a forma da tela, não um
  // "nenhum material" que ainda não é verdade. O perfil de uma amizade não depende dela.
  // A tela fica montada e só oculta (Activity), para a recarga depois de uma falha
  // não apagar o que a pessoa estava digitando.
  const libraryLoading = Boolean(model.account) && model.syncStatus === 'loading' && !(route === 'perfil' && params.get('id'));
  const skeleton = libraryLoading && current.loading;
  const page = <>{model.saveError && <div role="alert" className="form-error form-error-block page-alert"><p>{model.saveError}</p><button type="button" className="text-button accent" onClick={() => model.retrySave().catch(() => notify('Não foi possível carregar a biblioteca. Tente novamente.', { important: true }))}>Recarregar ou tentar novamente</button></div>}{skeleton && <PageSkeleton title={current.title} variant={current.loading}/>}<Activity mode={skeleton ? 'hidden' : 'visible'}><Suspense fallback={<PageSkeleton title={current.title} variant={current.loading || 'panel'}/>}>{current.render(routeContext)}</Suspense></Activity></>;
  const hideTabs = Boolean(current.hideTabs?.(routeContext));
  // Fora do Shell e da animação de entrada: um ancestral com transform deslocaria o position: fixed.
  if (checkingSession && route === 'login') return <SessionCheck/>;
  return <><Shell route={route} model={model} hideTabs={hideTabs} onHelp={() => open({ type: 'help' })} onRegister={() => setAuthMode('register')} onExit={exit}><Reminders account={model.account} syncStatus={model.syncStatus}/><motion.div className={`page page-${route}`} key={route} {...enter}>{page}</motion.div></Shell>
    <div className={`toast-region${toast ? '' : ' is-leaving'}`} role="status" aria-live="polite" aria-atomic="true"><AnimatePresence>{toast && <motion.div key="feedback" className="toast" initial={{ opacity: 0, y: 16, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8 }} transition={{ duration: .28, ease }}><span className="toast-icon"><Icon name="check"/></span><span>{toast.message}</span>{toast.action && <button className="toast-action" onClick={() => { clearTimeout(toastTimer.current); setToast(null); toast.action.run(); }}>{toast.action.label}</button>}{toast.action && <span className="toast-timer" key={toast.id} style={{ animationDuration: `${toast.duration}ms` }}/>}<button aria-label="Fechar aviso" className="icon-button" onClick={() => setToast(null)}><Icon name="close"/></button></motion.div>}</AnimatePresence></div>
    <MessageAlert account={model.account} quiet={Boolean(state.preferences?.focusShield && state.activeSession && !state.activeSession.paused)}/>
    {modal && <Dialog onClose={close} identity={`${modal.type}:${modal.id || ''}`}>
      <ModalContent modal={modal} state={state} settingsActions={model.settingsActions} libraryActions={model.libraryActions} progressActions={model.progressActions} open={open} close={close} notify={notify} go={go} account={model.account}/>
    </Dialog>}
  </>;
}
