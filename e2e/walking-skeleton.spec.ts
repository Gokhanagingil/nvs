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

test('shows live run polling progress with retained run inventory', async ({ page }) => {
  let progressCalls = 0;
  const liveRunId = 'live-ui-run';
  const inventory = {
    schemaVersion: 'nvs.resource-inventory/v1',
    runId: liveRunId,
    environmentId: 'local-example',
    tenantId: '33333333-3333-4333-8333-333333333333',
    incident: {
      id: '99999999-9999-4999-8999-999999999999',
      number: 'INC-NVS-UI',
      status: 'in_progress',
      disposition: 'RUN_OWNED',
    },
    resources: [],
    updatedAt: '2026-07-15T12:00:00.000Z',
  };
  const observations = [
    {
      schemaVersion: 'nvs.step-observation/v1',
      id: 'obs-live-ui-1',
      runId: liveRunId,
      stepId: 'step-live-ui-1',
      sourceStepId: 'report-degradation',
      sequence: 1,
      actorId: 'requester',
      semanticActorId: 'requester',
      actorProfileId: 'live-requester',
      action: 'incident.create',
      status: 'PASS',
      startedAt: '2026-07-15T12:00:00.000Z',
      completedAt: '2026-07-15T12:00:01.000Z',
      correlationId: 'corr-live-ui',
      evidence: { method: 'POST', pathTemplate: '/grc/itsm/incidents', httpStatus: 201 },
    },
  ];

  await page.route('**/api/environments/local-example/execution-readiness?**', async (route) => {
    await route.fulfill({
      json: {
        schemaVersion: 'nvs.execution-readiness/v1',
        environmentId: 'local-example',
        runType: 'LIVE_API',
        scenarioId: 'payment-api-service-degradation',
        variationValues: { journey: 'normal' },
        confirmed: false,
        staticEligible: true,
        verdict: 'PASS',
        mutationEligible: false,
        gateEligible: false,
        checks: [
          { id: 'server-mutation-switch', status: 'PASS', message: 'Test gate enabled.' },
          { id: 'concurrency', status: 'PASS', message: 'No live API run is active.' },
          {
            id: 'actor-authentication',
            status: 'NOT_CHECKED',
            message: 'Actor authentication requires confirmed preflight.',
          },
          {
            id: 'fixture-resources',
            status: 'NOT_CHECKED',
            message: 'Fixture resources require confirmed preflight.',
          },
        ],
      },
    });
  });
  await page.route(
    '**/api/environments/local-example/execution-readiness/confirm',
    async (route) => {
      await route.fulfill({
        json: {
          schemaVersion: 'nvs.execution-readiness/v1',
          environmentId: 'local-example',
          runType: 'LIVE_API',
          scenarioId: 'payment-api-service-degradation',
          variationValues: { journey: 'normal' },
          confirmed: true,
          staticEligible: true,
          verdict: 'PASS',
          mutationEligible: true,
          gateEligible: false,
          checks: [
            { id: 'server-mutation-switch', status: 'PASS', message: 'Test gate enabled.' },
            { id: 'concurrency', status: 'PASS', message: 'No live API run is active.' },
            {
              id: 'actor-authentication',
              status: 'PASS',
              message: 'Required live actor profiles authenticated read-only.',
            },
            {
              id: 'fixture-resources',
              status: 'PASS',
              message: 'Required fixture resources were verified read-only.',
            },
          ],
        },
      });
    },
  );
  await page.route('**/api/runs/live-active', async (route) => {
    await route.fulfill({
      json: {
        items: [],
      },
    });
  });
  await page.route('**/api/runs', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 202,
      json: { schemaVersion: 'nvs.live-run-accepted/v1', runId: liveRunId, status: 'ACCEPTED' },
    });
  });
  await page.route(`**/api/runs/${liveRunId}/progress`, async (route) => {
    progressCalls += 1;
    await route.fulfill({
      json: {
        schemaVersion: 'nvs.run-progress/v1',
        runId: liveRunId,
        status: progressCalls === 1 ? 'RUNNING' : 'COMPLETED',
        verdict: progressCalls === 1 ? 'PENDING' : 'PASS',
        observations,
        checkpoint: {
          schemaVersion: 'nvs.live-run-checkpoint/v1',
          runId: liveRunId,
          environmentId: 'local-example',
          fixtureId: 'fixture.incident-payment',
          status: progressCalls === 1 ? 'RUNNING' : 'COMPLETED',
          incidentId: '99999999-9999-4999-8999-999999999999',
          completedStepIds: ['step-live-ui-1'],
          cleanup: { attempted: false, status: 'NOT_REQUIRED' },
          updatedAt: '2026-07-15T12:00:01.000Z',
        },
      },
    });
  });
  await page.route(`**/api/runs/${liveRunId}/inventory`, async (route) => {
    await route.fulfill({ json: inventory });
  });
  await page.route(`**/api/runs/${liveRunId}/plan`, async (route) => {
    await route.fulfill({
      json: {
        schemaVersion: 'nvs.executable-plan/v1',
        id: 'plan-live-ui',
        scenario: { id: 'payment-api-service-degradation', version: '1.1.0' },
        variationValues: { journey: 'normal' },
        steps: [],
      },
    });
  });
  await page.route(`**/api/runs/${liveRunId}`, async (route) => {
    await route.fulfill({
      json: {
        schemaVersion: 'nvs.run/v2',
        runId: liveRunId,
        runType: 'LIVE_API',
        status: 'COMPLETED',
        verdict: 'PASS',
        gateEligible: true,
        assuranceScope: 'LIVE_NILES_INCIDENT_API',
        environmentId: 'local-example',
        scenario: { id: 'payment-api-service-degradation', version: '1.1.0' },
        variationValues: { journey: 'normal' },
        planId: 'plan-live-ui',
        fixtureId: 'fixture.incident-payment',
        toolVersions: { nvs: '0.1.0', node: 'v24.18.0', contracts: 'v2' },
        timestamps: {
          createdAt: '2026-07-15T12:00:00.000Z',
          completedAt: '2026-07-15T12:00:02.000Z',
        },
        stepResults: [{ stepId: 'step-live-ui-1', executionStatus: 'PASS' }],
        evidence: [],
        sanitization: { applied: true, redactedFields: [], patterns: [] },
        cleanup: {
          status: 'RETAINED_BY_POLICY',
          policy: 'RETAIN_CLOSED',
          details: 'Retained for UI polling test.',
        },
        resourceInventory: inventory,
      },
    });
  });

  await page.goto('/runs');
  await page.getByLabel('Run type').selectOption('LIVE_API');
  await page.getByLabel('Environment', { exact: true }).selectOption('local-example');
  await page
    .getByLabel('Scenario', { exact: true })
    .selectOption('payment-api-service-degradation');
  await page.getByLabel(/Approved positive, lifecycle, SLA/).selectOption('normal');
  await expect(page.getByText('Static gates passed')).toBeVisible();
  await page.getByRole('button', { name: 'Run confirmed preflight' }).click();
  await expect(page.getByText('Confirmed mutation eligible')).toBeVisible();
  await page.getByLabel(/Confirm this may create or change/).check();
  await page.getByRole('button', { name: 'Start confirmed live run' }).click();

  await expect(page.getByText('Live API progress')).toBeVisible();
  await expect(page.getByText(liveRunId)).toBeVisible();
  await expect(page.getByText('RUNNING', { exact: true })).toBeVisible();
  await expect(page.getByText('report-degradation')).toBeVisible();
  await expect(page.getByText('INC-NVS-UI')).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Live Incident API run completed' }),
  ).toBeVisible();
  expect(progressCalls).toBeGreaterThanOrEqual(2);
});
