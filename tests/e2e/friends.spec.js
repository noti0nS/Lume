import { test, expect } from '@playwright/test';

// Amizade por convite reutilizável, sem busca por e-mail e sem
// compartilhar biblioteca ou progresso.

async function register(page, testInfo, prefix, name = 'Pessoa de teste') {
  const email = `${prefix}-${testInfo.project.name}-${crypto.randomUUID()}@example.test`;
  await page.goto('/');
  await page.getByRole('button', { name: 'Criar conta', exact: true }).first().click();
  await page.getByLabel('Seu nome', { exact: true }).fill(name);
  await page.getByLabel('Seu @usuário').fill('u' + crypto.randomUUID().replace(/-/g, '').slice(0, 14));
  await page.getByLabel('E-mail', { exact: true }).fill(email);
  await page.getByLabel('Senha', { exact: true }).fill('senha-local-teste-123');
  await page.locator('#auth-form').getByRole('button', { name: 'Criar conta', exact: true }).click();
  await page.getByRole('button', { name: 'Explorar sem personalizar agora' }).click();
  await expect(page.getByRole('heading', { name: 'Início', exact: true })).toBeVisible();
  return email;
}

test('convite cria amizade entre duas contas sem compartilhar progresso', async ({ page, playwright }, testInfo) => {
  const baseURL = testInfo.project.use.baseURL;
  await register(page, testInfo, 'friend-a', 'Ana do teste');

  await page.getByRole('link', { name: 'Social', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Social', exact: true })).toBeVisible();
  await expect(page.getByText('Ninguém por aqui ainda. Um convite já começa a lista.')).toBeVisible();

  // O convite é criado em Adicionar amigos (#adicionar); aqui basta a rota.
  const invite = await page.request.post('/api/friends/invite', { data: {}, headers: { origin: baseURL } });
  expect(invite.status()).toBe(201);
  const code = (await invite.json()).code;
  expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);

  // Aceitar o próprio convite é bloqueado.
  const self = await page.request.post('/api/friends/accept', { data: { code }, headers: { origin: baseURL } });
  expect(self.status()).toBe(400);
  expect((await self.json()).code).toBe('self_invite');

  // Segunda conta, contexto próprio.
  const guest = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { origin: baseURL } });
  const stamp = `${testInfo.project.name}-${crypto.randomUUID()}`;
  const registered = await guest.post('/api/register', {
    data: { name: 'Bia do teste', email: `friend-b-${stamp}@example.test`, password: 'senha-local-teste-123' },
  });
  expect(registered.status()).toBe(201);

  const accepted = await guest.post('/api/friends/accept', { data: { code } });
  expect(accepted.status()).toBe(200);
  const acceptedBody = await accepted.json();
  expect(acceptedBody.friend.name).toBe('Ana do teste');

  // Reutilizar o código pela mesma pessoa é idempotente (não duplica amizade).
  const replay = await guest.post('/api/friends/accept', { data: { code } });
  expect(replay.status()).toBe(200);
  expect((await replay.json()).alreadyFriends).toBe(true);

  // A amizade não dá acesso ao estado da outra conta.
  const guestState = await guest.get('/api/state');
  expect((await guestState.json()).state).toBeNull();
  const guestFriends = await guest.get('/api/friends');
  expect((await guestFriends.json()).friends).toHaveLength(1);

  // Quem convidou vê a amizade depois de recarregar.
  await page.reload();
  await expect(page.locator('#main').getByText('Bia do teste', { exact: true })).toBeVisible();

  // O convite conta quantas pessoas entraram (a tela não lista mais o histórico de convites).
  const own = await (await page.request.get('/api/friends', { headers: { origin: baseURL } })).json();
  expect(own.invites.map((item) => item.uses)).toEqual([1]);

  // Remover encerra nos dois lados.
  await page.getByRole('button', { name: 'Remover Bia do teste da lista' }).click();
  await expect(page.getByText('Ninguém por aqui ainda. Um convite já começa a lista.')).toBeVisible();
  const guestAfter = await guest.get('/api/friends');
  expect((await guestAfter.json()).friends).toHaveLength(0);

  await guest.dispose();
});

test('link de convite preenche o código e a amizade não concede XP', async ({ page, playwright }, testInfo) => {
  const baseURL = testInfo.project.use.baseURL;
  await register(page, testInfo, 'friend-c', 'Davi do teste');
  const created = await page.request.post('/api/friends/invite', { headers: { origin: baseURL } });
  expect(created.status()).toBe(201);
  const { code } = await created.json();

  const guest = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { origin: baseURL } });
  const stamp = `${testInfo.project.name}-${crypto.randomUUID()}`;
  await guest.post('/api/register', {
    data: { name: 'Eva do teste', email: `friend-d-${stamp}@example.test`, password: 'senha-local-teste-123' },
  });

  // Abrir o link com ?convite= preenche o campo.
  await page.goto(`/#amigos?convite=${encodeURIComponent(code)}`);
  await expect(page.getByLabel('Código do convite')).toHaveValue(code);
  await expect(page.getByLabel('Código do convite')).toBeVisible();

  const accepted = await guest.post('/api/friends/accept', { data: { code } });
  expect(accepted.status()).toBe(200);
  const guestFriends = await guest.get('/api/friends');
  expect((await guestFriends.json()).friends[0].name).toBe('Davi do teste');

  // Convite e amizade não criam histórico nem XP em nenhum dos lados.
  const guestState = await guest.get('/api/state');
  expect((await guestState.json()).state).toBeNull();
  const hostState = await page.request.get('/api/state', { headers: { origin: baseURL } });
  const hostPayload = await hostState.json();
  expect(hostPayload.state?.progress ?? []).toHaveLength(0);

  await guest.dispose();
});
