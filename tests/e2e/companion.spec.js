import { test, expect } from '@playwright/test';
import { readAccount } from './library-helpers.js';

// Fluxo real do Lume Companion: pareamento por código, presença enviada pelo
// programa (simulada aqui com o token do dispositivo), exibição no painel e
// revogação. Nenhum XP é criado em nenhuma etapa.

async function register(page, testInfo, prefix) {
  const email = `${prefix}-${testInfo.project.name}-${crypto.randomUUID()}@example.test`;
  await page.goto('/');
  await page.getByRole('button', { name: 'Criar conta', exact: true }).first().click();
  await page.getByLabel('Seu nome', { exact: true }).fill('Pessoa do Companion');
  await page.getByLabel('Seu @usuário').fill('u' + crypto.randomUUID().replace(/-/g, '').slice(0, 14));
  await page.getByLabel('E-mail', { exact: true }).fill(email);
  await page.getByLabel('Senha', { exact: true }).fill('senha-local-teste-123');
  await page.locator('#auth-form').getByRole('button', { name: 'Criar conta', exact: true }).click();
  await page.getByRole('button', { name: 'Explorar sem personalizar agora' }).click();
  await expect(page.getByRole('heading', { name: 'Início', exact: true })).toBeVisible();
}

test('conectar programa, ver presença local e revogar o acesso', async ({ page, request }, testInfo) => {
  const baseURL = testInfo.project.use.baseURL;
  const sameOrigin = { origin: baseURL };
  await register(page, testInfo, 'companion');
  await page.goto('/#aplicativo');
  await expect(page.getByRole('heading', { name: 'Presença no desktop' })).toBeVisible();
  await expect(page.getByText('Nenhum programa conectado ainda.')).toBeVisible();

  await page.getByRole('button', { name: 'Conectar um programa' }).click();
  const code = (await page.locator('.companion-code > code').first().textContent())?.trim() || '';
  expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);

  const redeemed = await request.post('/api/companion/redeem', { data: { code, deviceName: 'QA Desktop' } });
  expect(redeemed.status()).toBe(201);
  const { token, device } = await redeemed.json();
  expect(token.length).toBeGreaterThan(30);
  expect(device.name).toBe('QA Desktop');

  // Reutilizar o mesmo código falha: uso único.
  const reused = await request.post('/api/companion/redeem', { data: { code, deviceName: 'Outro PC' } });
  expect(reused.status()).toBe(400);
  expect((await reused.json()).code).toBe('used_code');

  const since = new Date().toISOString();
  const presence = await request.put('/api/companion/presence', {
    headers: { authorization: `Bearer ${token}` },
    data: { app: 'Anki', category: 'study', since },
  });
  expect(presence.status()).toBe(200);

  await page.getByRole('button', { name: 'Atualizar status' }).click();
  await expect(page.getByText('Anki', { exact: true })).toBeVisible();
  await expect(page.getByText('observado localmente')).toBeVisible();
  await expect(page.locator('.companion-presence').getByText(/não gera XP/i)).toBeVisible();

  // Presença observada não cria histórico nem XP.
  const state = await readAccount(page);
  expect(state.progress).toHaveLength(0);

  await page.getByRole('button', { name: 'Desconectar QA Desktop' }).click();
  await expect(page.getByText('Nenhum programa conectado ainda.')).toBeVisible();
  await expect(page.getByText('Anki', { exact: true })).toHaveCount(0);

  const rejected = await request.put('/api/companion/presence', {
    headers: { authorization: `Bearer ${token}` },
    data: { app: 'Anki', category: 'study', since },
  });
  expect(rejected.status()).toBe(401);

  const listing = await page.request.get('/api/companion', { headers: sameOrigin });
  expect(listing.status()).toBe(200);
  expect((await listing.json()).devices).toHaveLength(0);
});
