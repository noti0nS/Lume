import { test, expect } from '@playwright/test';
import { materialSteps, stepUnits } from '../../public/material-model.js';
import { createInitialState, completeMission } from '../../public/domain.js';
import { seedAccount, readAccount } from './library-helpers.js';

// A biblioteca real começa vazia. Estes cenários de dados antigos precisam de
// trilhas próprias para conferir busca, pausa e restauração.
function seededState() {
  const steps = (prefix, count) => Array.from({ length: count }, (_, index) => ({ id: `${prefix}-${index + 1}`, title: `Etapa ${index + 1}` }));
  const state = createInitialState();
  state.courses = [
    { id: 'design', title: 'Design de interfaces', category: 'Design & criatividade', art: 'design', url: '', example: false, paused: false, units: stepUnits(steps('design', 4)) },
    { id: 'python', title: 'Primeiros passos em Python', category: 'Tecnologia & programação', art: 'code', url: '', example: false, paused: false, units: stepUnits(steps('python', 4)) },
  ];
  state.selectedCourseId = 'design';
  return state;
}

test('prévia, dados legados, busca, filtros, teclado, curso e progresso', { tag: '@celular' }, async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  // Biblioteca no formato atual, com uma aula já concluída.
  const at = new Date().toISOString();
  const oldState = completeMission(seededState(), 'design', 'design-1', { now: at }).state;
  oldState.onboarded = true;
  oldState.preferences.essential = true;
  oldState.supports = ['calm'];
  await seedAccount(page, oldState);
  await page.goto('/#hoje');
  await expect(page.getByRole('heading', { name: 'Início', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Etapa 2', exact: true })).toBeVisible();
  await expect(page.getByText('Continuidade.', { exact: true })).toBeVisible();
  await expect(page.getByText('Modo Essencial', { exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'Biblioteca', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Biblioteca', exact: true })).toBeVisible();
  await expect(page.locator('#main > div')).toHaveCSS('opacity', '1');
  const search = page.getByRole('searchbox');
  await search.fill('Python');
  await expect(page.locator('#library-results .course-card')).toHaveCount(1);
  await expect(search).toBeFocused();
  await page.getByRole('button', { name: 'Limpar busca' }).click();
  await expect(search).toBeFocused();
  await page.getByRole('button', { name: /^Concluídos \(/ }).click();
  await expect(page.getByRole('heading', { name: 'Nenhum material neste filtro.' })).toBeVisible();
  await page.getByRole('button', { name: /^Todos \(/ }).click();
  await page.getByRole('button', { name: 'Adicionar curso', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Adicionar curso', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Adicionar curso', exact: true }).click();
  await page.getByRole('tab', { name: 'Colar a grade' }).click();
  await page.getByLabel('Nome do curso (opcional)').fill('Leitura React');
  await page.getByLabel('Grade do curso').fill('Disciplina: Componentes\nMódulo: Fundamentos\nAula 1 — Props e estado\nAula 2 — Efeitos');
  await page.getByRole('button', { name: 'Organizar grade' }).click();
  await expect(page.getByRole('heading', { name: 'Leitura React' })).toBeVisible();
  await page.getByRole('button', { name: /Adicionar 2 aulas à biblioteca/ }).click();
  await expect(page.getByText('Importação concluída')).toBeVisible();
  await page.getByRole('button', { name: 'Voltar à biblioteca' }).click();
  await page.getByRole('button', { name: /^Leitura React,/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Continuar', exact: true }).click();
  await page.getByRole('button', { name: 'Concluí esta aula' }).click();
  await expect(page.getByText('registro manual').first()).toBeVisible();
  await page.getByRole('button', { name: 'Fechar janela' }).click();
  await expect(page.getByRole('button', { name: /^Leitura React,/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Biblioteca', exact: true })).toBeVisible();
  const restored = await readAccount(page);
  expect(restored.version).toBe(3);
  expect('history' in restored || 'completed' in restored || 'studyLog' in restored).toBe(false);
  const done = restored.progress.filter((event) => event.type === 'completion' && !event.revertedAt);
  expect(done).toHaveLength(2);
  expect(done.find((event) => event.unitId === 'design-1')).toMatchObject({ origin: 'manual' });
  expect(done.find((event) => event.materialTitle === 'Leitura React')?.origin).toBe('manual');
  expect(restored.preferences.essential).toBe(true); // Guardado como legado, sem efeito visual.
  await page.getByRole('button', { name: /^Menu da conta/ }).click();
  await page.getByRole('link', { name: 'Meu Perfil', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Colecionador de estudos', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Atividade recente', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Conquistas', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Editar perfil' }).click();
  await page.getByLabel('Selecionar foto de perfil do computador').setInputFiles('tests/fixtures/avatar.png');
  await page.getByLabel('Selecionar imagem de capa (header) do computador').setInputFiles('tests/fixtures/header.png');
  await page.getByLabel(/Apresentação e metas/).fill('Estudando React e Arquitetura\nMeta: 3 sessões por semana');
  await page.getByRole('button', { name: 'Salvar apresentação' }).click();
  await expect(page.getByText('Estudando React e Arquitetura')).toBeVisible();
  await expect.poll(async () => {
    const p = (await readAccount(page)).profile;
    return `${p?.avatar || ''}|${p?.header || ''}`;
  }).toMatch(/^\/api\/media\/profiles\/[^/]+\/avatar-\d+\.(webp|png|jpg)\|\/api\/media\/profiles\/[^/]+\/header-\d+\.(webp|png|jpg)$/);
  await page.screenshot({ path: `data/lume-${testInfo.project.name}-profile.png`, fullPage: true });
  await page.getByRole('button', { name: /^Menu da conta/ }).click();
  await page.getByLabel('Opções do usuário').getByRole('link', { name: 'Configurações', exact: true }).click();
  await page.getByRole('radio', { name: 'Claro' }).check();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.getByText(/movimento reduzido|modo essencial/i)).toHaveCount(0);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  expect(overflow).toBe(false);
  expect(errors).toEqual([]);
});

test('cadastro, saída, login, sincronização e recuperação na API local', async ({ page }, testInfo) => {
  const email = `react-${testInfo.project.name}-${crypto.randomUUID()}@example.test`;
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Entre no Lume' })).toBeVisible();
  await expect(page.locator('#main > div')).toHaveCSS('opacity', '1');
  await page.getByRole('button', { name: 'Criar conta', exact: true }).first().click();
  await page.getByLabel('Seu nome', { exact: true }).fill('Pessoa de teste');
  await page.getByLabel('Seu @usuário').fill('u' + crypto.randomUUID().replace(/-/g, '').slice(0, 14));
  await page.getByLabel('E-mail', { exact: true }).fill(email);
  await page.getByLabel('Senha', { exact: true }).fill('senha-local-teste-123');
  await page.getByRole('button', { name: 'Mostrar senha' }).click();
  await expect(page.getByLabel('Senha', { exact: true })).toHaveAttribute('type', 'text');
  await page.locator('#auth-form').getByRole('button', { name: 'Criar conta', exact: true }).click();
  await page.getByRole('button', { name: 'Explorar sem personalizar agora' }).click();
  await expect(page.getByRole('heading', { name: 'Início', exact: true })).toBeVisible();
  await expect(page.locator('#main > div')).toHaveCSS('opacity', '1');
  await page.getByRole('link', { name: 'Biblioteca', exact: true }).click();
  await page.getByRole('button', { name: 'Adicionar curso', exact: true }).click();
  await page.getByRole('tab', { name: 'Colar a grade' }).click();
  await page.getByLabel('Nome do curso (opcional)').fill('Curso da minha conta');
  await page.getByLabel('Grade do curso').fill('Aula 1 — Primeira aula');
  await page.getByRole('button', { name: 'Organizar grade' }).click();
  await page.getByRole('button', { name: /Adicionar 1 aula à biblioteca/ }).click();
  await page.getByRole('button', { name: 'Voltar à biblioteca' }).click();
  await page.getByRole('button', { name: /^Menu da conta/ }).click();
  await page.getByRole('button', { name: 'Sair', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Entre no Lume' })).toBeVisible();
  await page.getByLabel('E-mail', { exact: true }).fill(email);
  await page.getByLabel('Senha', { exact: true }).fill('senha-local-teste-123');
  await page.locator('#auth-form').getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Início', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Biblioteca', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Curso da minha conta,/ })).toBeVisible();
  await page.getByRole('button', { name: /^Menu da conta/ }).click();
  await page.getByRole('button', { name: 'Sair', exact: true }).click();
  await page.getByRole('link', { name: 'Esqueci minha senha' }).click();
  // Espera a tela de recuperação: durante a transição, o campo E-mail do login ainda existe.
  await expect(page.getByRole('heading', { name: 'Vamos recuperar seu acesso.' })).toBeVisible();
  await page.getByLabel('E-mail', { exact: true }).fill(email);
  await page.getByRole('button', { name: 'Solicitar recuperação' }).click();
  await expect(page.getByText(/enviamos um link de recuperação/)).toBeVisible();
  await page.getByRole('link', { name: 'Link de recuperação de teste' }).click();
  await page.getByLabel('Nova senha', { exact: true }).fill('nova-senha-local-123');
  await page.getByLabel('Repita a senha').fill('nova-senha-local-123');
  await page.getByRole('button', { name: 'Salvar nova senha' }).click();
  await expect(page.getByRole('heading', { name: 'Acesso validado.' })).toBeVisible();
});

test('jornada 3 configura ritmo e primeira matéria sem gerar XP', async ({ page }) => {
  await seedAccount(page, createInitialState());
  await page.goto('/');
  await page.getByRole('heading', { name: 'Estudo com frequência', exact: true }).click();

  // Etapa 2: ritmo diário e conforto sonoro
  await expect(page.getByRole('heading', { name: 'Quanto tempo por dia?' })).toBeVisible();
  await page.getByRole('radio', { name: /^Chuva/ }).click();
  await page.getByRole('button', { name: 'Continuar' }).click();

  // Etapa 3: primeira matéria (Caderno em Branco)
  await expect(page.getByRole('heading', { name: 'Adicione sua primeira matéria.' })).toBeVisible();
  await page.getByLabel('Nome da disciplina ou assunto').fill('Algoritmos');
  await page.getByRole('button', { name: 'Continuar' }).click();

  // Etapa 4: amigos (opcional) -> concluir
  await expect(page.getByRole('heading', { name: 'Quer estudar com alguém?' })).toBeVisible();
  await page.getByRole('button', { name: 'Concluir e ir para o Início' }).click();

  await expect(page.getByRole('heading', { name: 'Início', exact: true })).toBeVisible();
  await expect(page.getByText(/Algoritmos · Primeiro Caderno/).first()).toBeVisible();

  const state = await readAccount(page);
  expect(state.onboarded).toBe(true);
  expect(state.onboarding.status).toBe('done');
  expect(state.onboarding.journey).toBe('often');
  expect(state.preferences.soundscape).toBe('rain');
  expect(state.progress).toEqual([]);
  expect(state.courses.some(course => course.title.startsWith('Algoritmos') && course.origin === 'onboarding')).toBe(true);

  // Navegação das telas restantes continua funcionando
  await page.getByRole('link', { name: 'Biblioteca', exact: true }).click();
  await page.getByRole('button', { name: /^Algoritmos · Primeiro Caderno,/ }).click();
  await page.getByRole('button', { name: 'Pausar curso' }).click();
  await expect(page.getByRole('button', { name: 'Retomar curso' })).toBeVisible();
  await page.getByRole('button', { name: 'Retomar curso' }).click();
  await page.getByRole('button', { name: 'Fechar janela' }).click();
  // Quatro destinos no menu; as telas secundárias ficam nas abas de cada seção ou no menu da conta.
  const menu = page.getByRole('navigation', { name: 'Navegação' });
  await expect(menu.getByRole('link')).toHaveCount(4);
  for (const [section, tab, heading] of [['Plano de Estudos', 'Tarefas', 'Tarefas'], ['Social', 'Ranking', 'Ranking']]) {
    await menu.getByRole('link', { name: section, exact: true }).click();
    await page.getByRole('navigation', { name: `Seções de ${section}` }).getByRole('link', { name: tab, exact: true }).click();
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
  }
  // Conquistas abre pelo menu da conta, na aba ao lado de Meu perfil.
  await page.getByRole('button', { name: /^Menu da conta/ }).click();
  await page.getByLabel('Opções do usuário').getByRole('link', { name: 'Conquistas', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Suas conquistas', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Seções de Perfil' }).getByRole('link', { name: 'Meu caminho' })).toHaveCount(0);
  // Endereços antigos: Missões e Roteiro abrem o Plano; Meu caminho abre Conquistas.
  await page.goto('/#missoes');
  await expect(page.getByRole('heading', { name: 'Plano de Estudos', exact: true })).toBeVisible();
  await page.goto('/#historico');
  await expect(page.getByRole('heading', { name: 'Suas conquistas', exact: true })).toBeVisible();
});
