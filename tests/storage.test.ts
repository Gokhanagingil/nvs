import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NvsCore } from '@nvs/core';
import { sha256 } from '@nvs/domain';
import {
  FilesystemEnvironmentRepository,
  FilesystemRunBundleRepository,
  FilesystemScenarioRepository,
  RunIdAlreadyExistsError,
  StorageCorruptionError,
  UnsafeIdentifierError,
  type BundlePersistenceHooks,
} from '@nvs/storage-filesystem';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let temporaryRoot: string;
const repositoryRoot = process.cwd();

beforeEach(async () => {
  temporaryRoot = await mkdtemp(path.join(tmpdir(), 'nvs-storage-'));
});

afterEach(async () => {
  await rm(temporaryRoot, { recursive: true, force: true });
});

function buildCore(bundles: FilesystemRunBundleRepository): NvsCore {
  return new NvsCore(
    new FilesystemEnvironmentRepository(path.join(repositoryRoot, 'environments')),
    new FilesystemScenarioRepository(path.join(repositoryRoot, 'scenarios')),
    bundles,
    {
      probe: async (environment) => ({
        environmentId: environment.id,
        verdict: 'PASS',
        health: { available: true, status: 200 },
        readiness: { available: false },
        openApi: { available: false },
        version: { available: false, source: 'NONE' },
      }),
    },
  );
}

async function createRun(bundles: FilesystemRunBundleRepository, runId = 'storage-test-run') {
  return buildCore(bundles).createCompileOnlyRun({
    runId,
    environmentId: 'local-example',
    scenarioId: 'payment-api-service-degradation',
    variationValues: { journey: 'normal' },
    now: '2026-07-14T12:00:00.000Z',
  });
}

describe('filesystem repositories', () => {
  it('rejects traversal identifiers', async () => {
    const bundles = new FilesystemRunBundleRepository(temporaryRoot);
    const environments = new FilesystemEnvironmentRepository(
      path.join(repositoryRoot, 'environments'),
    );

    await expect(bundles.get('../outside')).rejects.toBeInstanceOf(UnsafeIdentifierError);
    await expect(bundles.getPlan('../outside')).rejects.toBeInstanceOf(UnsafeIdentifierError);
    await expect(environments.get('..')).rejects.toBeInstanceOf(UnsafeIdentifierError);
  });

  it('reports YAML and committed-bundle corruption without absolute paths', async () => {
    const environmentRoot = path.join(temporaryRoot, 'environments');
    await mkdir(environmentRoot, { recursive: true });
    await writeFile(path.join(environmentRoot, 'broken.yaml'), 'schemaVersion: [', 'utf8');

    await expect(new FilesystemEnvironmentRepository(environmentRoot).list()).rejects.toMatchObject(
      {
        name: 'StorageCorruptionError',
        message: 'Environment data is invalid or corrupted: broken.yaml',
      },
    );

    const runDirectory = path.join(temporaryRoot, 'runs', 'corrupt-run');
    await mkdir(runDirectory, { recursive: true });
    await writeFile(path.join(runDirectory, '.committed'), 'nvs.run-bundle/v1\n', 'utf8');
    await writeFile(path.join(runDirectory, 'run.json'), '{not-json', 'utf8');
    await writeFile(path.join(runDirectory, 'plan.json'), '{}', 'utf8');
    await writeFile(path.join(runDirectory, 'evidence.json'), '{}', 'utf8');
    const bundles = new FilesystemRunBundleRepository(temporaryRoot);
    await expect(bundles.get('corrupt-run')).rejects.toBeInstanceOf(StorageCorruptionError);
    await expect(bundles.list()).resolves.toEqual([]);
  });

  it('does not expose an incomplete bundle without a commit marker', async () => {
    const runDirectory = path.join(temporaryRoot, 'runs', 'incomplete-run');
    await mkdir(runDirectory, { recursive: true });
    await writeFile(path.join(runDirectory, 'run.json'), '{"verdict":"PASS"}\n', 'utf8');
    const bundles = new FilesystemRunBundleRepository(temporaryRoot);

    await expect(bundles.list()).resolves.toEqual([]);
    await expect(bundles.get('incomplete-run')).resolves.toBeUndefined();
    await expect(bundles.getPlan('incomplete-run')).resolves.toBeUndefined();
    await expect(bundles.getEvidence('incomplete-run')).resolves.toBeUndefined();
  });

  it('atomically persists an immutable bundle with exact persisted-byte hashes', async () => {
    const bundles = new FilesystemRunBundleRepository(temporaryRoot);
    const created = await createRun(bundles);

    expect(created.verdict).toBe('PASS');
    expect(created.gateEligible).toBe(false);
    expect(
      created.stepResults.every(
        (step) => step.compilationStatus === 'PASS' && step.executionStatus === 'NOT_EXECUTED',
      ),
    ).toBe(true);
    expect((await bundles.get(created.runId))?.planId).toBe(created.planId);
    expect((await bundles.getPlan(created.runId))?.id).toBe(created.planId);
    expect((await bundles.getPlan(created.runId))?.steps[0]?.source.blueprintStepId).toBe(
      'report-degradation',
    );

    const manifest = await bundles.getEvidence(created.runId);
    expect(manifest?.entries).toHaveLength(3);
    expect(manifest?.entries.map((entry) => entry.kind).sort()).toEqual([
      'MANIFEST',
      'PLAN',
      'RUN',
    ]);

    const runDirectory = path.join(temporaryRoot, 'runs', created.runId);
    const runBytes = await readFile(path.join(runDirectory, 'run.json'), 'utf8');
    const planBytes = await readFile(path.join(runDirectory, 'plan.json'), 'utf8');
    const evidenceBytes = await readFile(path.join(runDirectory, 'evidence.json'), 'utf8');
    const commitMarker = JSON.parse(await readFile(path.join(runDirectory, '.committed'), 'utf8'));
    expect(manifest?.entries.find((entry) => entry.kind === 'RUN')?.sha256).toBe(sha256(runBytes));
    expect(manifest?.entries.find((entry) => entry.kind === 'PLAN')?.sha256).toBe(
      sha256(planBytes),
    );
    expect(commitMarker.hashes).toEqual({
      'evidence.json': sha256(evidenceBytes),
      'plan.json': sha256(planBytes),
      'run.json': sha256(runBytes),
    });
    expect(runBytes).toMatch(/\n$/);
    expect((await readdir(runDirectory)).sort()).toEqual([
      '.committed',
      'evidence.json',
      'plan.json',
      'run.json',
    ]);
  });

  it('rejects a duplicate run ID without changing the committed bundle', async () => {
    const bundles = new FilesystemRunBundleRepository(temporaryRoot);
    const created = await createRun(bundles, 'duplicate-run');
    const runFile = path.join(temporaryRoot, 'runs', created.runId, 'run.json');
    const originalBytes = await readFile(runFile, 'utf8');

    await expect(createRun(bundles, created.runId)).rejects.toBeInstanceOf(RunIdAlreadyExistsError);
    expect(await readFile(runFile, 'utf8')).toBe(originalBytes);
    await expect(bundles.list()).resolves.toHaveLength(1);
  });

  it.each(['plan.json', 'run.json', 'evidence.json'] as const)(
    'does not expose a partial PASS run when %s persistence fails',
    async (failedDocument) => {
      const hooks: BundlePersistenceHooks = {
        afterWrite(document) {
          if (document === failedDocument) {
            throw new Error(`injected ${document} failure`);
          }
        },
      };
      const bundles = new FilesystemRunBundleRepository(temporaryRoot, hooks);

      await expect(createRun(bundles, 'injected-failure-run')).rejects.toThrow(
        `injected ${failedDocument} failure`,
      );
      await expect(bundles.list()).resolves.toEqual([]);
      await expect(bundles.get('injected-failure-run')).resolves.toBeUndefined();
      await expect(
        readdir(path.join(temporaryRoot, 'runs', 'injected-failure-run')),
      ).rejects.toMatchObject({ code: 'ENOENT' });
    },
  );

  it.each(['run.json', '.committed'] as const)(
    'does not expose a partial PASS run when %s promotion fails',
    async (failedDocument) => {
      const hooks: BundlePersistenceHooks = {
        beforePromote(document) {
          if (document === failedDocument) {
            throw new Error(`injected ${document} promotion failure`);
          }
        },
      };
      const bundles = new FilesystemRunBundleRepository(temporaryRoot, hooks);

      await expect(createRun(bundles, 'promotion-failure-run')).rejects.toThrow(
        `injected ${failedDocument} promotion failure`,
      );
      await expect(bundles.list()).resolves.toEqual([]);
      await expect(bundles.get('promotion-failure-run')).resolves.toBeUndefined();
      await expect(
        readdir(path.join(temporaryRoot, 'runs', 'promotion-failure-run')),
      ).rejects.toMatchObject({ code: 'ENOENT' });
    },
  );
});
