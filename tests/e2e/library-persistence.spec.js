import { test, expect } from '@playwright/test';
import { seedAccount, readAccount } from './library-helpers.js';

// A interceptação de falhas precisa controlar a requisição, sem service worker.
test.use({ serviceWorkers: 'block' });

test('resposta perdida permite repetir a mesma operação sem duplicar a tarefa', async ({ page }) => {
  await seedAccount(page);
  await page.goto('/#tarefas');
  const ids = [];
  await page.route('**/api/library/actions', async (route) => {
    ids.push(route.request().postDataJSON().id);
    if (ids.length === 1) {
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      await route.abort('failed');
    } else await route.continue();
  });
  await page.getByLabel('Tarefa', { exact: true }).fill('Revisar concorrência');
  await page.getByRole('button', { name: 'Adicionar tarefa' }).click();
  await expect(page.getByRole('alert')).toContainText('Não foi possível confirmar a gravação');
  await page.getByLabel('Tarefa', { exact: true }).fill('Rascunho preservado');
  await page.getByRole('button', { name: 'Adicionar tarefa' }).click();
  await expect(page.getByLabel('Tarefa', { exact: true })).toHaveValue('Rascunho preservado');
  expect(ids).toHaveLength(1);
  await page.getByRole('button', { name: 'Recarregar ou tentar novamente' }).click();
  const saved = await readAccount(page);
  expect(saved.tasks.filter((task) => task.title === 'Revisar concorrência')).toHaveLength(1);
  expect(ids).toHaveLength(2);
  expect(ids[1]).toBe(ids[0]);
  await expect(page.getByLabel('Tarefa', { exact: true })).toHaveValue('Rascunho preservado');
  await page.reload();
  await expect(page.getByText('Revisar concorrência', { exact: true })).toBeVisible();
});

test('prévia não carrega dados antigos nem persiste alterações após recarga', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('lume.prototype.v1', JSON.stringify({ onboarded: true, courses: [{ id: 'old', title: 'Não carregar' }] })));
  await page.goto('/');
  await page.getByRole('button', { name: 'Explorar a prévia' }).click();
  await page.getByRole('button', { name: 'Explorar sem personalizar agora' }).click();
  await page.goto('/#tarefas');
  await page.getByLabel('Tarefa', { exact: true }).fill('Somente na prévia');
  await page.getByRole('button', { name: 'Adicionar tarefa' }).click();
  await expect(page.getByText('Somente na prévia', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('lume.prototype.v1'))).toBeNull();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Entre no Lume' })).toBeVisible();
  await expect(page.getByText('Somente na prévia', { exact: true })).toHaveCount(0);
});

test('duas abas recebem conflito explícito e recarregam sem mesclar documentos', async ({ page }) => {
  await seedAccount(page);
  await page.goto('/#tarefas');
  await expect(page.getByRole('heading', { name: 'Tarefas', exact: true })).toBeVisible();
  const other = await page.context().newPage();
  await other.goto('/#tarefas');
  await expect(other.getByRole('heading', { name: 'Tarefas', exact: true })).toBeVisible();
  await page.getByLabel('Tarefa', { exact: true }).fill('Primeira aba');
  await page.getByRole('button', { name: 'Adicionar tarefa' }).click();
  await readAccount(page);
  await other.getByLabel('Tarefa', { exact: true }).fill('Segunda aba');
  await other.getByRole('button', { name: 'Adicionar tarefa' }).click();
  await expect(other.getByRole('alert')).toContainText('A biblioteca mudou');
  await other.getByRole('button', { name: 'Recarregar ou tentar novamente' }).click();
  await expect(other.getByText('Primeira aba', { exact: true })).toBeVisible();
  await expect(other.getByText('Segunda aba', { exact: true })).toHaveCount(0);
  expect((await readAccount(other)).tasks.map((task) => task.title)).toEqual(['Primeira aba']);
  await other.close();
});
