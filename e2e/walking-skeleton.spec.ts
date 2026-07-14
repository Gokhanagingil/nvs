import { expect, test } from '@playwright/test';

test('reviews the payment narrative and inspects compile-only evidence', async ({ page }) => {
  await page.goto('/scenarios');

  await expect(page.getByRole('heading', { name: 'Scenario Library' })).toBeVisible();
  await expect(
    page.getByText(/customer-facing payment\/API service suffers severe degradation/i),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Human-readable journey' })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Report severe payment API degradation' }),
  ).toBeVisible();

  await page.getByRole('link', { name: 'Run Center' }).click();
  await expect(page.getByRole('heading', { name: 'Run Center' })).toBeVisible();
  await page.getByLabel('Environment', { exact: true }).selectOption('local-example');
  await page
    .getByLabel('Scenario', { exact: true })
    .selectOption('payment-api-service-degradation');
  await page.getByLabel(/Approved positive, lifecycle, SLA/).selectOption('normal');
  await page.getByRole('button', { name: 'Launch compile-only run' }).click();

  await expect(page.getByText('Not release-gate eligible · gateEligible: false')).toBeVisible();
  await expect(page.getByText(/not a NILES release verdict/i)).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Business-step compilation progress' }),
  ).toBeVisible();
  await expect(page.getByText('NOT_EXECUTED').first()).toBeVisible();

  await page.getByRole('link', { name: 'View evidence' }).click();
  await expect(page.getByRole('heading', { name: 'Evidence Explorer' })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Compile-only evidence · not a NILES release verdict' }),
  ).toBeVisible();
  await expect(page.getByText('No (gateEligible: false)')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Compiled plan entries' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Evidence manifest' })).toBeVisible();
  await expect(page.getByText(/runs\/.+\/run\.json/)).toBeVisible();
  await expect(page.getByText(/runs\/.+\/plan\.json/)).toBeVisible();
});

test('runs safe multi-actor authentication preflight and denies production', async ({ page }) => {
  await page.goto('/environments');

  await expect(page.getByRole('heading', { name: 'Environments' })).toBeVisible();
  await expect(page.getByText(/0\.1\.0 · unknown SHA/i)).toBeVisible();

  const localEnvironment = page
    .getByRole('article')
    .filter({ has: page.getByRole('heading', { name: 'Sanitized local NILES example' }) });
  await expect(localEnvironment.getByText('5/5 configured')).toBeVisible();
  await expect(localEnvironment.getByText(/creates no Incident records/i)).toBeVisible();
  await localEnvironment.getByRole('button', { name: 'Run authentication preflight' }).click();

  await expect(
    localEnvironment.getByText('Authentication readiness only · not release-gate eligible'),
  ).toBeVisible();
  await expect(localEnvironment.getByText('AUTHENTICATED', { exact: true })).toHaveCount(2);
  await expect(localEnvironment.getByText('MFA_REQUIRED')).toBeVisible();
  await expect(localEnvironment.getByText('LOGIN_RESPONSE_MALFORMED')).toBeVisible();
  await expect(localEnvironment.getByText('TENANT_MISMATCH')).toBeVisible();
  await expect(localEnvironment.getByText('gateEligible: false')).toBeVisible();

  const renderedText = await page.locator('body').innerText();
  expect(renderedText).not.toMatch(
    /mock-requester-token|mock-service-desk-token|mock-mfa-token|synthetic-e2e-value|@example\.invalid/i,
  );

  const productionEnvironment = page
    .getByRole('article')
    .filter({ has: page.getByRole('heading', { name: 'Sanitized production NILES example' }) });
  await expect(
    productionEnvironment.getByText(
      'Authentication preflight is forbidden for production environments.',
      { exact: false },
    ),
  ).toBeVisible();
  await expect(
    productionEnvironment.getByRole('button', { name: 'Run authentication preflight' }),
  ).toBeDisabled();
});
