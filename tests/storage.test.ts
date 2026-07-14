import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NvsCore } from '@nvs/core';
import {
  FilesystemEnvironmentRepository,
  FilesystemEvidenceRepository,
  FilesystemRunRepository,
  FilesystemScenarioRepository,
  StorageCorruptionError,
  UnsafeIdentifierError,
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

describe('filesystem repositories', () => {
  it('rejects traversal identifiers', async () => {
    const runs = new FilesystemRunRepository(temporaryRoot);
    const environments = new FilesystemEnvironmentRepository(
      path.join(repositoryRoot, 'environments'),
    );

    await expect(runs.get('../outside')).rejects.toBeInstanceOf(UnsafeIdentifierError);
    await expect(runs.getPlan('../outside')).rejects.toBeInstanceOf(UnsafeIdentifierError);
    await expect(environments.get('..')).rejects.toBeInstanceOf(UnsafeIdentifierError);
  });

  it('reports YAML and JSON corruption without absolute paths', async () => {
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
    await writeFile(path.join(runDirectory, 'run.json'), '{not-json', 'utf8');
    await expect(
      new FilesystemRunRepository(temporaryRoot).get('corrupt-run'),
    ).rejects.toBeInstanceOf(StorageCorruptionError);
    await writeFile(path.join(runDirectory, 'plan.json'), '{not-json', 'utf8');
    await expect(
      new FilesystemRunRepository(temporaryRoot).getPlan('corrupt-run'),
    ).rejects.toBeInstanceOf(StorageCorruptionError);
  });

  it('persists a compile-only run, plan, and evidence with stable atomic JSON', async () => {
    const runs = new FilesystemRunRepository(temporaryRoot);
    const evidence = new FilesystemEvidenceRepository(temporaryRoot);
    const core = new NvsCore(
      new FilesystemEnvironmentRepository(path.join(repositoryRoot, 'environments')),
      new FilesystemScenarioRepository(path.join(repositoryRoot, 'scenarios')),
      runs,
      evidence,
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

    const created = await core.createCompileOnlyRun({
      runId: 'storage-test-run',
      environmentId: 'local-example',
      scenarioId: 'payment-api-service-degradation',
      variationValues: { journey: 'normal' },
      now: '2026-07-14T12:00:00.000Z',
    });

    expect(created.verdict).toBe('PASS');
    expect(created.gateEligible).toBe(false);
    expect((await runs.get(created.runId))?.planId).toBe(created.planId);
    expect((await runs.getPlan(created.runId))?.id).toBe(created.planId);
    expect((await runs.getPlan(created.runId))?.steps[0]?.source.blueprintStepId).toBe(
      'report-degradation',
    );
    const manifest = await evidence.get(created.runId);
    expect(manifest?.entries).toHaveLength(2);
    expect(manifest?.entries.find((entry) => entry.kind === 'PLAN')?.sha256).toMatch(
      /^[a-f0-9]{64}$/,
    );

    const runDirectory = path.join(temporaryRoot, 'runs', created.runId);
    expect(await readFile(path.join(runDirectory, 'run.json'), 'utf8')).toMatch(/\n$/);
    expect((await readdir(runDirectory)).some((name) => name.includes('.tmp-'))).toBe(false);
  });
});
