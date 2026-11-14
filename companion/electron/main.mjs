// Lume — processo principal do app de desktop.
//
// A janela principal carrega o próprio Lume publicado (mesma conta, mesmos
// amigos, mesmo perfil). O núcleo local cuida só de presença, roteiro e
// atualização: o app não lê a tela, apenas nomes de processo da allowlist.

import { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, shell } from 'electron';
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_API, createCompanion, pairDevice, readConfig, setDiscordPresence, setPaused, unpairDevice,
} from '../core.mjs';
import { createIpcDiscordClient } from '../discord-client.mjs';
import { createDiscordPresence, normalizeStudy, resolveDiscordSettings } from '../discord-presence.mjs';
import { checkForUpdate, downloadInstaller, RELEASES_PAGE } from '../update.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const assets = app.isPackaged ? join(process.resourcesPath, 'assets') : join(here, '..', 'assets');
const smoke = process.argv.includes('--smoke') || process.env.LUME_COMPANION_SMOKE === '1';
const TITLEBAR_HEIGHT = 36;

let tray = null;
let mainWindow = null;
let panelWindow = null;
let companion = null;
let discord = null;
let quitting = false;
let state = {
  running: false, paused: false, paired: false, deviceName: '', apiUrl: '',
  detected: null, since: null, plan: null, error: null,
};
// Atividade enviada pela janela do Lume (aula, PDF, foco). A página renova a
// cada poucos segundos; sem renovação (janela fechada, página recarregada ou
// travada), o status volta ao roteiro.
const STUDY_TTL_MS = 75_000;
let study = null;
let studyAt = 0;
let studyTimer = null;

function currentStudy() {
  return study && Date.now() - studyAt < STUDY_TTL_MS ? study : null;
}

function syncDiscord() {
  if (!discord) return Promise.resolve();
  return discord.sync({ ...(companion?.getState() || state), study: currentStudy() }).catch(() => {});
}

function setStudy(value) {
  const next = normalizeStudy(value);
  const changed = JSON.stringify(next) !== JSON.stringify(study);
  study = next;
  studyAt = Date.now();
  clearTimeout(studyTimer);
  if (next) {
    studyTimer = setTimeout(() => { syncDiscord(); }, STUDY_TTL_MS + 500);
    if (typeof studyTimer.unref === 'function') studyTimer.unref();
  }
  if (changed) syncDiscord();
}

let discordStatus = { enabled: true, configured: false, status: 'unconfigured' };
let updateInfo = {
  status: 'idle', currentVersion: '', latest: null, assetName: '', progress: 0, error: null, file: null, page: RELEASES_PAGE,
};

if (process.platform === 'win32') app.setAppUserModelId('com.lume.app');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showMain());

  app.whenReady().then(async () => {
    companion = createCompanion({
      onUpdate: (value) => {
        state = value;
        broadcast();
        syncDiscord();
      },
    });
    state = companion.getState();
    if (!smoke) {
      discord = createDiscordPresence({
        createClient: (clientId) => createIpcDiscordClient(clientId),
        readSettings: () => resolveDiscordSettings(readConfig(), process.env),
        log: (message) => console.info(message),
        onStatus: (value) => {
          discordStatus = value;
          broadcast();
        },
      });
    }
    discordStatus = discordGuess();

    try {
      tray = new Tray(trayImage(state));
      tray.on('click', () => showMain());
      tray.on('double-click', () => showMain());
      buildMenu();
    } catch (error) {
      console.warn(`companion:tray-unavailable ${error?.message || error}`);
      tray = null;
    }

    if (smoke) {
      // Verificação automática: abre a janela principal escondida, espera o site
      // carregar, grava o resultado e encerra.
      const file = process.env.LUME_COMPANION_SMOKE_FILE || join(here, '..', 'smoke-result.json');
      const result = { ok: true, electron: process.versions.electron, tray: Boolean(tray), paired: state.paired, appUrl: appUrl() };
      try {
        createMainWindow();
        result.window = await new Promise((resolve) => {
          const timer = setTimeout(() => resolve({ loaded: false, reason: 'timeout' }), 20000);
          mainWindow.webContents.once('did-finish-load', () => {
            clearTimeout(timer);
            resolve({ loaded: true, title: mainWindow.webContents.getTitle(), url: mainWindow.webContents.getURL() });
          });
          mainWindow.webContents.once('did-fail-load', (_event, code, description) => {
            clearTimeout(timer);
            resolve({ loaded: false, code, reason: description });
          });
        });
        writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
      } catch (error) {
        console.error(`companion-smoke:write-failed ${error.message}`);
        try { writeFileSync(file, `${JSON.stringify({ ...result, ok: false, error: String(error.message) }, null, 2)}\n`); } catch { /* sem marcador. */ }
      }
      quitting = true;
      app.quit();
      return;
    }

    createMainWindow();
    mainWindow.once('ready-to-show', () => mainWindow.show());
    if (state.paired) await companion.start();
    else if (discord) await syncDiscord();
  }).catch((error) => {
    console.error(`companion:startup-failed ${error?.stack || error}`);
    if (smoke) {
      try {
        writeFileSync(process.env.LUME_COMPANION_SMOKE_FILE || join(here, '..', 'smoke-result.json'), `${JSON.stringify({ ok: false, error: String(error?.message || error) }, null, 2)}\n`);
      } catch { /* sem marcador, o teste falha por ausência. */ }
      quitting = true;
      app.quit();
    }
  });
}

app.on('window-all-closed', () => {
  // Com bandeja ativa, o app continua em segundo plano; sem bandeja, encerra.
  if (!tray) app.quit();
});

app.on('before-quit', async (event) => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  try { await discord?.stop(); } catch { /* sair mesmo assim. */ }
  try { await companion?.stop(); } catch { /* sair mesmo assim. */ }
  app.quit();
});

function image(name) {
  return nativeImage.createFromPath(join(assets, name));
}

function appIcon() {
  const packaged = join(assets, 'icon.png');
  if (existsSync(packaged)) return nativeImage.createFromPath(packaged);
  const dev = join(here, '..', 'build', 'icon.png');
  return existsSync(dev) ? nativeImage.createFromPath(dev) : undefined;
}

function trayImage(value) {
  if (!value.paired) return image('tray-off.png');
  if (value.paused) return image('tray-paused.png');
  return image('tray-active.png');
}

function trayLabel(value) {
  if (!value.paired) return 'Lume — presença desconectada';
  if (value.paused) return 'Lume — presença pausada';
  if (value.detected) return `Lume · ${value.detected.label} · ${value.detected.category}`;
  return 'Lume — aguardando um aplicativo da lista';
}

function buildMenu() {
  if (!tray) return;
  const items = [
    { label: trayLabel(state), enabled: false },
    { type: 'separator' },
    { label: 'Abrir o Lume', click: () => showMain() },
    { label: 'Presença e pareamento', click: () => showPanel() },
    { label: 'Verificar atualização', click: () => { showPanel(); checkUpdate().catch(() => {}); } },
    { label: 'Abrir no navegador', click: () => shell.openExternal(state.apiUrl || readConfig().apiUrl) },
  ];
  if (state.paired) {
    items.push({ type: 'separator' });
    items.push({ label: state.paused ? 'Retomar presença' : 'Pausar presença', click: () => togglePause() });
    items.push({ label: 'Desconectar este computador', click: () => disconnect() });
  }
  if (state.plan) {
    items.push({ type: 'separator' });
    items.push({ label: `Faltam ${state.plan.totals.remaining} aulas`, enabled: false });
    const next = state.plan.steps?.[0];
    if (next) items.push({ label: `Próxima: ${truncate(next.title, 42)}`, enabled: false, click: () => showMain() });
  }
  items.push({ type: 'separator' });
  items.push({
    label: discordStatus.enabled ? 'Ocultar do Discord' : 'Mostrar no Discord',
    click: () => { toggleDiscord().catch(() => {}); },
  });
  items.push({ label: 'Sair', click: () => app.quit() });
  tray.setContextMenu(Menu.buildFromTemplate(items));
  tray.setToolTip(trayLabel(state));
}

function truncate(value, max) {
  const text = String(value || '');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function discordGuess() {
  const settings = resolveDiscordSettings(readConfig(), process.env);
  return {
    enabled: settings.enabled,
    configured: settings.configured,
    status: !settings.enabled ? 'off' : settings.configured ? 'connecting' : 'unconfigured',
  };
}

function snapshot() {
  return { ...state, platform: process.platform, discord: discordStatus, update: { ...updateInfo, currentVersion: app.getVersion() } };
}

function broadcast() {
  if (tray) {
    tray.setImage(trayImage(state));
    buildMenu();
  }
  if (panelWindow && !panelWindow.isDestroyed()) panelWindow.webContents.send('state', snapshot());
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('lume:update-status', { ...updateInfo, currentVersion: app.getVersion(), platform: process.platform });
  }
}

// ---------- Atualização ----------

async function checkUpdate() {
  updateInfo = { ...updateInfo, status: 'checking', error: null, progress: 0 };
  broadcast();
  try {
    const result = await checkForUpdate({ current: app.getVersion() });
    updateInfo = {
      ...updateInfo,
      status: result.available ? 'available' : 'current',
      latest: result.latest,
      assetName: result.assetName || '',
      installerUrl: result.installerUrl || null,
      size: result.size || 0,
      notes: result.notes || '',
      page: result.page || RELEASES_PAGE,
      file: null,
      progress: 0,
    };
  } catch (error) {
    updateInfo = { ...updateInfo, status: 'error', error: error.message || String(error) };
  }
  broadcast();
  return snapshot();
}

async function downloadUpdate() {
  if (!updateInfo.installerUrl) throw new Error('Verifique a atualização antes de baixar.');
  updateInfo = { ...updateInfo, status: 'downloading', progress: 0, error: null };
  broadcast();
  try {
    const destDir = process.platform === 'linux' ? app.getPath('downloads') : '';
    const file = await downloadInstaller({
      url: updateInfo.installerUrl,
      version: updateInfo.latest,
      assetName: updateInfo.assetName,
      destDir,
      onProgress: (percent) => {
        updateInfo = { ...updateInfo, progress: percent ?? updateInfo.progress };
        broadcast();
      },
    });
    updateInfo = { ...updateInfo, status: 'ready', file, progress: 100 };
  } catch (error) {
    updateInfo = { ...updateInfo, status: 'error', error: error.message || String(error), progress: 0 };
  }
  broadcast();
  return snapshot();
}

async function installUpdate() {
  if (!updateInfo.file) throw new Error('Nenhum instalador baixado ainda.');
  if (process.platform === 'linux' && /\.AppImage$/i.test(updateInfo.file)) {
    shell.showItemInFolder(updateInfo.file);
  } else {
    const failure = await shell.openPath(updateInfo.file);
    if (failure) {
      if (process.platform === 'linux') shell.showItemInFolder(updateInfo.file);
      else throw new Error(failure);
    }
  }
  updateInfo = { ...updateInfo, status: 'installing' };
  broadcast();
  return snapshot();
}

// ---------- Janelas ----------
// A janela principal é o próprio Lume: o mesmo site publicado, na mesma origem,
// para a conta, os amigos e o perfil continuarem iguais aos do navegador.
// O painel pequeno cuida do que é local: presença, pareamento e atualização.

function appUrl() {
  return readConfig().apiUrl || DEFAULT_API;
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'Lume',
    icon: appIcon(),
    backgroundColor: '#0c111b',
    autoHideMenuBar: true,
    // Barra de título própria: os botões nativos ficam sobre o topo do site,
    // com as cores do tema, como em editores e apps de desktop modernos.
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0c111b', symbolColor: '#eef2f7', height: TITLEBAR_HEIGHT },
    webPreferences: {
      preload: join(here, 'main-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
      // A Agenda consulta lembretes mesmo com a janela minimizada/na bandeja.
      backgroundThrottling: false,
    },
  });

  mainWindow.loadURL(appUrl());
  mainWindow.on('close', (event) => {
    if (quitting || !tray) return;
    event.preventDefault();
    mainWindow.hide();
  });
  // Links de fora abrem no navegador; o app fica no Lume.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith(appUrl())) return;
    event.preventDefault();
    shell.openExternal(url);
  });
  mainWindow.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    if (!isMainFrame || code === -3) return;
    mainWindow.loadFile(join(here, 'renderer', 'offline.html'), { query: { url: appUrl(), code: String(code), reason: description } });
  });
}

function createPanelWindow() {
  panelWindow = new BrowserWindow({
    width: 400,
    height: 640,
    minWidth: 340,
    minHeight: 480,
    show: false,
    title: 'Lume — presença',
    icon: appIcon(),
    backgroundColor: '#0c111b',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(here, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  panelWindow.loadFile(join(here, 'renderer', 'index.html'));
  panelWindow.on('close', (event) => {
    if (quitting || !tray) return;
    event.preventDefault();
    panelWindow.hide();
  });
  panelWindow.webContents.on('did-finish-load', () => panelWindow.webContents.send('state', snapshot()));
}

function showMain() {
  if (!mainWindow || mainWindow.isDestroyed()) createMainWindow();
  mainWindow.show();
  mainWindow.focus();
}

function showPanel() {
  if (!panelWindow || panelWindow.isDestroyed()) createPanelWindow();
  panelWindow.show();
  panelWindow.focus();
}

async function toggleDiscord() {
  const enabled = readConfig().discordPresence !== false;
  setDiscordPresence(!enabled);
  if (discord) await syncDiscord();
  else discordStatus = discordGuess();
  broadcast();
  return snapshot();
}

async function togglePause() {
  const next = !readConfig().paused;
  setPaused(next);
  if (next) await companion.stop();
  else await companion.start();
  state = companion.getState();
  broadcast();
  syncDiscord();
  return state;
}

async function disconnect() {
  await companion.stop();
  await unpairDevice();
  state = companion.getState();
  broadcast();
  return state;
}

ipcMain.on('lume:study', (event, value) => {
  if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) return;
  setStudy(value);
});

ipcMain.on('lume:theme', (_event, theme) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const dark = theme !== 'light';
  try {
    mainWindow.setTitleBarOverlay({
      color: dark ? '#0c111b' : '#f4f6fa',
      symbolColor: dark ? '#eef2f7' : '#0c111b',
      height: TITLEBAR_HEIGHT,
    });
  } catch { /* plataformas sem overlay seguem com a barra padrão. */ }
});

ipcMain.handle('lume:update', async (_event, name) => {
  if (name === 'check') return checkUpdate();
  if (name === 'download') return downloadUpdate();
  if (name === 'install') return installUpdate();
  return { ...updateInfo, currentVersion: app.getVersion() };
});

ipcMain.handle('action', async (_event, name, payload = {}) => {
  switch (name) {
    case 'state':
      return snapshot();
    case 'pair': {
      const code = String(payload.code || '').trim();
      if (!code) throw new Error('Informe o código mostrado no Lume.');
      const result = await pairDevice(code, {
        name: String(payload.name || '').trim() || 'Meu computador',
        apiUrl: String(payload.apiUrl || '').trim(),
      });
      await companion.stop();
      await companion.refreshPlan();
      await companion.start();
      state = companion.getState();
      broadcast();
      return { ...state, device: result.device };
    }
    case 'toggle-pause':
      return togglePause();
    case 'toggle-discord':
      return toggleDiscord();
    case 'unpair':
      return disconnect();
    case 'refresh':
      await companion.refreshPlan();
      state = companion.getState();
      broadcast();
      return state;
    case 'open-lume':
      await shell.openExternal(state.apiUrl || readConfig().apiUrl);
      return state;
    case 'open-settings':
      await shell.openExternal(`${(state.apiUrl || readConfig().apiUrl).replace(/\/+$/, '')}/#aplicativo`);
      return state;
    case 'update-check':
      return checkUpdate();
    case 'update-download':
      return downloadUpdate();
    case 'update-install':
      return installUpdate();
    case 'hide':
      panelWindow?.hide();
      return state;
    case 'quit':
      app.quit();
      return state;
    default:
      throw new Error('Ação desconhecida.');
  }
});
