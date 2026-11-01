// Cliente IPC do Discord. Só o processo principal do Electron importa este
// arquivo: o site e o Worker não alcançam o pipe do cliente desktop.

import { Client } from '@xhayper/discord-rpc';

export function createIpcDiscordClient(clientId) {
  const client = new Client({ clientId: String(clientId) });
  let notifyDisconnect = () => {};

  client.on('disconnected', () => {
    notifyDisconnect();
  });

  return {
    async connect() {
      await client.login();
    },
    async setActivity(activity) {
      if (!client.user) throw new Error('Discord ainda não está pronto.');
      await client.user.setActivity({
        details: activity?.details,
        state: activity?.state,
        startTimestamp: activity?.startTimestamp,
        largeImageKey: activity?.largeImageKey,
        largeImageText: activity?.largeImageText,
        buttons: activity?.buttons,
        instance: false,
      });
    },
    async clearActivity() {
      if (!client.isConnected || !client.user) return;
      await client.user.clearActivity();
    },
    async destroy() {
      notifyDisconnect = () => {};
      try { await client.destroy(); } catch { /* já estava fechado. */ }
    },
    onDisconnect(handler) {
      notifyDisconnect = typeof handler === 'function' ? handler : () => {};
    },
  };
}
