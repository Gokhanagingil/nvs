import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

async function source(relativePath: string): Promise<string> {
  return readFile(path.join(root, relativePath), 'utf8');
}

describe('production and deployment assets', () => {
  it('pins CI actions and validates the exact production container', async () => {
    const workflow = await source('.github/workflows/ci.yml');

    expect(workflow).toContain('concurrency:');
    expect(workflow).toContain('cancel-in-progress:');
    expect(workflow).toContain('pnpm run ci');
    expect(workflow).toContain('docker build');
    expect(workflow).toContain('ops/verify-deployment.sh');
    expect(workflow).toContain('docker restart nvs-ci');
    expect(workflow).toContain('ci-persistence-probe');
    expect(workflow).not.toMatch(/uses:\s+\S+@v\d/);
  });

  it('keeps staging manual, exact-image, host-key pinned, and rollback capable', async () => {
    const workflow = await source('.github/workflows/deploy-staging.yml');
    const deploy = await source('ops/deploy-staging.sh');
    const rollback = await source('ops/rollback-staging.sh');

    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).not.toMatch(/^\s+push:/m);
    expect(workflow).toContain('StrictHostKeyChecking=yes');
    expect(workflow).toContain('NVS_STAGING_SSH_KNOWN_HOSTS');
    expect(workflow).toContain('docker save "$image"');
    expect(workflow).toContain('NVS_IMAGE_ARCHIVE');
    expect(workflow).not.toContain('ssh-keyscan');
    expect(workflow).not.toMatch(/uses:\s+\S+@v\d/);

    expect(deploy).toContain('previous_image=');
    expect(deploy).toContain('Loaded image metadata does not match the requested SHA.');
    expect(deploy).toContain('Restoring previously active image');
    expect(deploy).toContain('Rollback verified');
    expect(deploy).not.toContain('docker compose down');
    expect(rollback).toContain('Rollback image metadata does not match the requested SHA.');
    expect(rollback).toContain('Manual rollback verified');
  });

  it('mounts server-owned configuration and data without embedding credentials', async () => {
    const compose = await source('docker-compose.staging.yml');
    const image = await source('Dockerfile');
    const environmentExample = await source('.env.example');

    expect(compose).toContain('image: ${NVS_IMAGE:');
    expect(compose).toContain('./config:/app/config:ro');
    expect(compose).toContain('./data:/var/lib/nvs');
    expect(compose).toContain('127.0.0.1:${NVS_HOST_PORT:-4100}:4100');
    expect(image).toContain('USER node');
    expect(image).toContain('NVS_BUILD_SHA');
    expect(environmentExample).not.toMatch(/^NVS_CREDENTIAL_[A-Z0-9_]+=(?!\s*$).+/m);
  });
});
