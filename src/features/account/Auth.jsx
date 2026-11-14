import { useState } from 'react';
import { motion } from 'motion/react';
import Icon from '../../ui/Icon.jsx';
import { Button, Logo, Star, enter } from '../../ui/ui.jsx';
import { api, apiError } from '../../lib/api.js';
import HandleField from './HandleField.jsx';
import { STUDY_GOALS } from '../../../public/domain.js';

// Força da senha só como orientação visual; a regra de verdade é a do servidor
// (8 a 72 bytes). Não bloqueia o envio.
function passwordStrength(value) {
  const text = String(value || '');
  const checks = [text.length >= 8, text.length >= 12, /[a-zà-ú]/.test(text) && /[A-ZÀ-Ú]/.test(text), /\d/.test(text) && /[^\p{L}\d]/u.test(text)];
  const score = text ? checks.filter(Boolean).length : 0;
  return { score, label: ['Digite uma senha', 'Fraca', 'Razoável', 'Boa', 'Forte e protegida'][score] };
}

// Um objetivo por id de STUDY_GOALS (public/domain.js): outro id some ao recarregar.
const OBJECTIVE_COPY = {
  college: 'Faculdade',
  exams: 'Concursos',
  research: 'Pós & Pesquisa',
  personal: 'Pessoal',
};
const OBJECTIVES = STUDY_GOALS.map((id) => [id, OBJECTIVE_COPY[id]]);

const WEEK_PREVIEW = [
  ['Seg', 'done'],
  ['Ter', 'done'],
  ['Qua', 'done'],
  ['Qui', 'today'],
  ['Sex', 'idle'],
  ['Sáb', 'idle'],
  ['Dom', 'idle'],
];

export function Login({ model, mode, setMode, go, notify }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [visible, setVisible] = useState(false);
  const [password, setPassword] = useState('');
  const [studyGoal, setStudyGoal] = useState('college');
  const [acceptedTerms, setAcceptedTerms] = useState(true);
  const [termsOpen, setTermsOpen] = useState(false);
  const [handle, setHandle] = useState('');

  const registering = mode === 'register';

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    if (registering && !acceptedTerms) {
      setError('Confirme que leu o compromisso de privacidade e uso para criar sua conta.');
      return;
    }
    if (registering && handle.length < 3) {
      setError('Escolha um @usuário com pelo menos 3 caracteres para que seus amigos encontrem você.');
      document.getElementById('auth-handle')?.focus();
      return;
    }
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    try {
      const result = await api(registering ? '/api/register' : '/api/login', {
        method: 'POST',
        body: { name: data.get('name'), email: data.get('email'), password: data.get('password'), ...(registering ? { handle } : {}) },
      });
      if (!result.ok) throw new Error(apiError(result));
      await model.loadAccountProgress(result.data.user);
      if (registering && studyGoal) {
        model.settingsActions?.setPreference?.('studyGoal', studyGoal);
      }
      model.setAccountStatus('ready');
      setMode('login');
      go('hoje');
      notify(`Que bom ter você aqui, ${result.data.user.name.split(' ')[0]}.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const strength = passwordStrength(password);

  return <div className="stitch-auth-layout">
    <header className="stitch-entry-topbar">
      <div className="stitch-entry-topbar-inner">
        <a className="brand" href="#conheca" aria-label="Lume — início">
          <Logo size={22}/>
          <span className="brand-name">Lume</span>
        </a>
        <div className="stitch-entry-topbar-actions">
          <a className="text-button" href="#conheca">Conheça o Lume</a>
        </div>
      </div>
    </header>

    <main className="stitch-auth-main">
      <div className={`auth-split-grid ${registering ? 'is-register' : ''}`}>
        <section className="auth-editorial" aria-hidden="true">
          {registering ? <>
            <div className="auth-editorial-eyebrow">
              <span className="auth-editorial-dot"/>
              <span className="mono">Espaço de estudo dedicado</span>
            </div>
            <h1 className="auth-editorial-title">Comece com clareza, no seu ritmo.</h1>
            <p className="auth-editorial-sub">Reúna PDFs, aulas, prazos e metas de foco em um único lugar.</p>

            <div className="auth-showcase-card">
              <div className="auth-showcase-head">
                <span className="mono auth-showcase-kicker">Semana em pontos</span>
                <span className="soft-badge mono">Ritmo constante</span>
              </div>
              <div className="auth-week-grid">
                {WEEK_PREVIEW.map(([day, state]) => (
                  <div key={day} className={`auth-week-day is-${state}`}>
                    <span className="mono">{day}</span>
                    <span className="auth-week-node">
                      {state === 'today' ? <Star size={14}/> : <span className="auth-week-pip"/>}
                    </span>
                  </div>
                ))}
              </div>
              <div className="auth-showcase-foot mono">
                <Icon name="clock"/>
                <span>Meta diária · 25 min</span>
              </div>
            </div>

            <p className="auth-assurance mono">Gratuito para começar · Amigos e ranking opcionais</p>
          </> : <>
            <h1 className="auth-editorial-title">Seus estudos em dia, disciplina por disciplina.</h1>
            <p className="auth-editorial-sub">Organize provas, entregas e materiais sem sobrecarga.</p>

            <div className="auth-showcase-card">
              <div className="auth-showcase-head">
                <span className="auth-subject-chip mono">Cálculo II</span>
                <span className="mono auth-showcase-code">MOD-04 // RESUMO</span>
              </div>
              <p className="auth-showcase-topic">Derivadas Parciais e Gradiente</p>
              <div className="auth-constellation">
                <span className="auth-c-node is-done"/>
                <span className="auth-c-line is-done"/>
                <span className="auth-c-node is-done"/>
                <span className="auth-c-line is-active"/>
                <span className="auth-c-star"><Star size={18}/></span>
                <span className="auth-c-line is-future"/>
                <span className="auth-c-node is-future"/>
              </div>
              <div className="auth-countdown-pill mono">
                <Icon name="clock"/>
                <span>PROVA EM 4 DIAS · 18:00</span>
              </div>
            </div>

            <p className="auth-assurance mono">Sem anúncios · Pausar não tira XP · Seus dados são seus</p>
          </>}
        </section>

        <section className="auth-card-col" aria-labelledby="auth-card-title">
          <div className="auth-card stitch-auth-card">
            <div className="auth-card-top">
              <div className="segmented" role="group" aria-label="Entrar ou criar conta">
                {[['login', 'Entrar'], ['register', 'Criar conta']].map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={mode === id}
                    onClick={() => { setMode(id); setError(''); }}
                  >
                    {mode === id && <motion.span layoutId="auth-selection" className="segmented-highlight" transition={{ duration: .3, ease: [.22, 1, .36, 1] }}/>}
                    <span>{label}</span>
                  </button>
                ))}
              </div>
            </div>

            <motion.div key={mode} {...enter}>
              <div className="auth-title">
                <h2 id="auth-card-title" className="headline">{registering ? 'Crie sua conta' : 'Entre no Lume'}</h2>
                <p>{registering ? 'Leva menos de um minuto.' : 'Retome seus materiais e sessões de onde parou.'}</p>
              </div>

              <form id="auth-form" className="form-stack stitch-auth-form" onSubmit={submit} aria-busy={busy}>
                {registering && <div className="form-grid">
                  <div className="field">
                    <label htmlFor="auth-name">Seu nome</label>
                    <input
                      id="auth-name"
                      name="name"
                      autoComplete="name"
                      enterKeyHint="next"
                      required
                      minLength={2}
                      maxLength={60}
                      placeholder="Ana Luz"
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="auth-handle">Seu @usuário</label>
                    <HandleField id="auth-handle" value={handle} onChange={setHandle}/>
                  </div>
                </div>}

                <div className="field">
                  <label htmlFor="auth-email">E-mail</label>
                  <input
                    id="auth-email"
                    name="email"
                    type="email"
                    autoComplete="username"
                    spellCheck={false}
                    enterKeyHint="next"
                    required
                    maxLength={254}
                    placeholder="nome@exemplo.com"
                  />
                  <span className="field-inline-error" role="alert">Informe um e-mail válido no formato nome@exemplo.com.</span>
                </div>

                <div className="field">
                  <div className="field-label-row">
                    <label htmlFor="auth-password">Senha</label>
                    {registering && password && <span className="strength-inline-label mono" aria-live="polite">{strength.label}</span>}
                  </div>
                  <span className="password-field">
                    <input
                      id="auth-password"
                      name="password"
                      type={visible ? 'text' : 'password'}
                      autoComplete={registering ? 'new-password' : 'current-password'}
                      enterKeyHint="done"
                      required
                      minLength={8}
                      maxLength={registering ? 72 : 200}
                      placeholder={registering ? 'Mínimo de 8 caracteres' : '••••••••'}
                      value={password}
                      onChange={event => setPassword(event.target.value)}
                    />
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={visible ? 'Ocultar senha' : 'Mostrar senha'}
                      aria-pressed={visible}
                      onClick={() => setVisible(v => !v)}
                    >
                      <Icon name={visible ? 'eye-off' : 'eye'}/>
                    </button>
                  </span>
                  {!registering && <a className="text-link auth-forgot" href="#recuperar">Esqueci minha senha</a>}
                  {registering && <span className="strength-bars auth-strength-bars" aria-hidden="true">
                    {[1, 2, 3, 4].map(step => <span key={step} className={strength.score >= step ? 'is-on' : ''}/>)}
                  </span>}
                </div>

                {registering && <div className="auth-objectives">
                  <span className="auth-objectives-label">Objetivo inicial</span>
                  <div className="auth-objectives-grid" role="radiogroup" aria-label="Objetivo inicial de estudo">
                    {OBJECTIVES.map(([id, label]) => {
                      const selected = studyGoal === id;
                      return <button
                        key={id}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        className={`objective-chip ${selected ? 'is-selected' : ''}`}
                        onClick={() => setStudyGoal(id)}
                      >
                        {selected && <span className="objective-dot" aria-hidden="true"/>}
                        <span>{label}</span>
                      </button>;
                    })}
                  </div>
                </div>}

                {registering && <div className="auth-terms-wrap">
                  <label className="auth-check">
                    <input type="checkbox" checked={acceptedTerms} onChange={e => setAcceptedTerms(e.target.checked)}/>
                    <span>
                      Concordo com a{' '}
                      <button type="button" className="text-button inline-link" onClick={() => setTermsOpen(o => !o)}>
                        Privacidade e Uso
                      </button> do Lume.
                    </span>
                  </label>
                  {termsOpen && <p className="auth-terms-note">
                    Seus materiais, progresso e sessões pertencem à sua conta. Senhas ficam armazenadas apenas como hash seguro e não há anúncios ou venda de dados.
                  </p>}
                </div>}

                {error && <p className="form-error" role="alert">{error}</p>}

                <Button type="submit" className="full-width large" disabled={busy || model.accountStatus === 'checking'}>
                  {busy ? 'Um instante…' : registering ? 'Criar conta' : 'Entrar'}
                </Button>
              </form>
            </motion.div>

            {registering ? (
              <div className="auth-preview-inline">
                <button type="button" className="text-button" onClick={() => { model.enterPreview(); go('inicio'); }}>
                  Ou explore a prévia sem conta
                </button>
              </div>
            ) : <>
              <div className="auth-divider"><span>ou</span></div>
              <button type="button" className="auth-preview-btn" onClick={() => { model.enterPreview(); go('inicio'); }}>
                <strong>Explorar a prévia sem conta</strong>
                <small className="mono">Temporária, só na aba aberta.</small>
              </button>
              <div className="auth-card-foot mono">
                <span className={`session-state state-${model.accountStatus}`}>
                  <span className="dot"/>
                  {model.accountStatus === 'checking' ? 'Verificando sessão…' : model.accountStatus === 'offline' ? 'Servidor indisponível' : 'Acesso seguro com e-mail e senha'}
                </span>
                <a href="#aplicativo">Aplicativo desktop</a>
              </div>
            </>}
          </div>
        </section>
      </div>
    </main>

    <footer className="stitch-entry-footer">
      <div className="stitch-entry-footer-inner">
        <span>Provas, trabalhos e entregas em dia.</span>
        <nav aria-label="Links de entrada">
          <a href="#conheca">Conheça o Lume</a>
          <a href="#recuperar">Recuperar acesso</a>
          <a href="#aplicativo">Aplicativo desktop</a>
        </nav>
      </div>
    </footer>
  </div>;
}

export function Recovery({ reset = false, notify, go }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    const data = new FormData(event.currentTarget);
    if (reset && data.get('password') !== data.get('confirm')) { setError('As duas senhas precisam ser iguais.'); return; }
    setBusy(true); setError('');
    try {
      const token = new URLSearchParams(location.hash.split('?')[1]).get('token') || '';
      const response = await api(reset ? '/api/password/reset' : '/api/password/request', { method: 'POST', body: reset ? { token, password: data.get('password') } : { email: data.get('email') } });
      if (!response.ok) throw new Error(apiError(response));
      setResult(response.data);
      if (reset) { history.replaceState(null, '', '#redefinir'); notify('Acesso validado. Entre com a nova senha.'); }
    } catch (error) { setError(error.message); }
    finally { setBusy(false); }
  }
  return <section className="recovery-card crest-card">
    <span className={`dialog-emblem ${result ? 'tone-mint' : ''}`}><Icon name={result ? 'shield' : reset ? 'lock' : 'mail'}/></span>
    <h1 className="headline">{reset ? result ? 'Acesso validado.' : 'Uma nova senha.' : 'Vamos recuperar seu acesso.'}</h1>
    {result ? <>
      <p className="muted-text">{reset ? 'Sua senha foi atualizada. Você já pode entrar.' : 'Se existir uma conta para esse e-mail, enviamos um link de recuperação. Ele vale por 30 minutos; confira também a caixa de spam.'}</p>
      {!reset && result.resetUrl && <a className="text-link" href={result.resetUrl}>Link de recuperação de teste</a>}
      <Button className="full-width" onClick={() => go('login')}>Voltar à entrada<Icon name="arrow"/></Button>
    </> : <form className="form-stack" onSubmit={submit} aria-busy={busy}>
      <p className="muted-text">{reset ? 'Escolha uma senha com pelo menos 8 caracteres.' : 'Informe o e-mail da sua conta. O link de recuperação vale por 30 minutos.'}</p>
      {reset ? <><label className="field">Nova senha<input name="password" type="password" autoComplete="new-password" minLength={8} maxLength={72} required/></label><label className="field">Repita a senha<input name="confirm" type="password" autoComplete="new-password" minLength={8} maxLength={72} required/></label></> : <label className="field">E-mail<input name="email" type="email" autoComplete="username" spellCheck={false} required maxLength={254} placeholder="nome@exemplo.com"/></label>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <Button type="submit" className="full-width" disabled={busy}>{busy ? 'Um instante…' : reset ? 'Salvar nova senha' : 'Solicitar recuperação'}</Button>
      <a className="text-link centered" href="#login">Voltar à entrada</a>
    </form>}
  </section>;
}
