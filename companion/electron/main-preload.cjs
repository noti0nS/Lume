// Ponte da janela principal: só o que a barra de título e o botão de atualização
// precisam. A página continua sem acesso a Node, sistema de arquivos ou token.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lumeWindow', {
  // Avisa a cor do tema para os botões nativos da janela acompanharem o app.
  setTheme(theme) {
    ipcRenderer.send('lume:theme', String(theme || 'dark'));
  },
  // O que está sendo estudado (aula, PDF, foco) para o status do Discord.
  // `null` limpa. A página só envia nomes que já mostra na tela.
  setStudy(value) {
    ipcRenderer.send('lume:study', value && typeof value === 'object' ? value : null);
  },
  update: {
    check: () => ipcRenderer.invoke('lume:update', 'check'),
    download: () => ipcRenderer.invoke('lume:update', 'download'),
    install: () => ipcRenderer.invoke('lume:update', 'install'),
    status: () => ipcRenderer.invoke('lume:update', 'status'),
    onStatus(callback) {
      const listener = (_event, value) => callback(value);
      ipcRenderer.on('lume:update-status', listener);
      return () => ipcRenderer.removeListener('lume:update-status', listener);
    },
  },
});
