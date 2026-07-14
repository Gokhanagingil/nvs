import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { checkLocalReadiness, type RuntimePaths } from '../apps/api/src/operations.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const repositoryRoot = process.cwd();
let temporaryRoot: string;
let configRoot: string;
let dataRoot: string;

function runtimePaths(): RuntimePaths {
  return {
    configDir: configRoot,
    dataDir: dataRoot,
    webDir: path.join(temporaryRoot, 'web'),
  };
}

async function createConfigurationDirectories(): Promise<void> {
  await Promise.all(
    ['actors/mappings', 'actors/profiles', 'environments', 'scenarios'].map((directory) =>
      mkdir(path.join(configRoot, directory), { recursive: true }),
    ),
  );
}

async function copyValidConfiguration(): Promise<void> {
  await Promise.all(
    ['actors', 'environments', 'scenarios'].map((directory) =>
      cp(path.join(repositoryRoot, directory), path.join(configRoot, directory), {
        recursive: true,
      }),
    ),
  );
}

beforeEach(async () => {
  temporaryRoot = await mkdtemp(path.join(tmpdir(), 'nvs-readiness-'));
  configRoot = path.join(temporaryRoot, 'config');
  dataRoot = path.join(temporaryRoot, 'data');
});

afterEach(async () => {
  await rm(temporaryRoot, { recursive: true, force: true });
});

describe('local operational readiness', () => {
  it('accepts usable versioned configuration and writable storage', async () => {
    await copyValidConfiguration();

    await expect(checkLocalReadiness(runtimePaths())).resolves.toEqual({
      schemaVersion: 'nvs.readiness/v1',
      status: 'ready',
      checks: { configuration: 'ok', storage: 'ok' },
    });
  });

  it('blocks an empty configuration tree', async () => {
    await createConfigurationDirectories();

    await expect(checkLocalReadiness(runtimePaths())).resolves.toMatchObject({
      status: 'blocked',
      checks: { configuration: 'blocked', storage: 'ok' },
      error: { code: 'LOCAL_CONFIGURATION_INVALID' },
    });
  });

  it('blocks a malformed environment definition', async () => {
    await copyValidConfiguration();
    await writeFile(
      path.join(configRoot, 'environments', 'local.example.yaml'),
      'schemaVersion: nvs.environment/unknown\nid: local-example\n',
      'utf8',
    );

    await expect(checkLocalReadiness(runtimePaths())).resolves.toMatchObject({
      status: 'blocked',
      error: { code: 'LOCAL_CONFIGURATION_INVALID' },
    });
  });

  it('blocks an enabled non-production environment without an actor mapping', async () => {
    await copyValidConfiguration();
    await rm(path.join(configRoot, 'actors', 'mappings', 'local-example.yaml'));

    await expect(checkLocalReadiness(runtimePaths())).resolves.toMatchObject({
      status: 'blocked',
      error: { code: 'LOCAL_CONFIGURATION_INVALID' },
    });
  });

  it('blocks a mapping whose profile does not match the required persona', async () => {
    await copyValidConfiguration();
    const profilePath = path.join(configRoot, 'actors', 'profiles', 'local-requester.yaml');
    const profile = await readFile(profilePath, 'utf8');
    await writeFile(profilePath, profile.replace('persona: requester', 'persona: tenant-admin'));

    await expect(checkLocalReadiness(runtimePaths())).resolves.toMatchObject({
      status: 'blocked',
      error: { code: 'LOCAL_CONFIGURATION_INVALID' },
    });
  });

  it('blocks a persistent data path that cannot be used as a directory', async () => {
    await copyValidConfiguration();
    await writeFile(dataRoot, 'not-a-directory', 'utf8');

    await expect(checkLocalReadiness(runtimePaths())).resolves.toMatchObject({
      status: 'blocked',
      checks: { configuration: 'ok', storage: 'blocked' },
      error: { code: 'LOCAL_STORAGE_UNAVAILABLE' },
    });
  });
});
