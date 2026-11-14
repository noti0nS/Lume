// Detecta a janela do app de desktop. O Electron usa um User-Agent próprio que
// inclui o nome do programa (`lume/0.5.0`) e `Electron/`. Exigir os dois evita
// esconder o convite de instalação em outros navegadores baseados em Electron,
// como o navegador embutido do OpenCode.
export function isDesktopApp(userAgent) {
  const value = userAgent === undefined
    ? (typeof navigator === 'undefined' ? '' : navigator.userAgent)
    : userAgent;
  const text = String(value || '');
  return /\bElectron\//i.test(text) && /\blume\//i.test(text);
}

export function desktopPlatform(userAgent) {
  const value = userAgent === undefined
    ? (typeof navigator === 'undefined' ? '' : navigator.userAgent)
    : userAgent;
  const text = String(value || '');
  if (/\bLinux\b/i.test(text) && !/\bAndroid\b/i.test(text)) return 'linux';
  return 'windows';
}

// Marca o documento antes do React desenhar, para a barra de título do app
// ocupar o topo sem piscar no navegador.
export function markDesktop() {
  if (typeof document === 'undefined' || !isDesktopApp()) return false;
  document.documentElement.dataset.desktop = 'true';
  return true;
}

// Mantém os botões nativos da janela (minimizar, maximizar, fechar) com as
// cores do tema em uso.
export function syncTitleBar(theme) {
  if (typeof window === 'undefined') return;
  try {
    window.lumeWindow?.setTheme?.(theme === 'light' ? 'light' : 'dark');
  } catch { /* sem overlay, segue com a barra padrão. */ }
}

// Avisa o aplicativo do que está sendo estudado (aula, PDF, foco), para o
// status do Discord. `null` limpa. No navegador não faz nada.
export function reportStudy(activity) {
  if (typeof window === 'undefined') return;
  try {
    window.lumeWindow?.setStudy?.(activity || null);
  } catch { /* sem ponte, o status segue pelo roteiro. */ }
}
