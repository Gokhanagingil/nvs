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

  await page.getByRole('link', { name: 'View evidence' }).click();
  await expect(page.getByRole('heading', { name: 'Evidence Explorer' })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Compile-only evidence · not a NILES release verdict' }),
  ).toBeVisible();
  await expect(page.getByText('No (gateEligible: false)')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Compiled plan entries' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Evidence manifest' })).toBeVisible();
});
