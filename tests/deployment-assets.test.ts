import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

async function source(relativePath: string): Promise<string> {
  return readFile(path.join(root, relativePath), 'utf8');
}

describe('production and deployment assets', () => {
  it('pins CI actions and validates hardened container proofs', async () => {
    const workflow = await source('.github/workflows/ci.yml');

    expect(workflow).toContain('concurrency:');
    expect(workflow).toContain('cancel-in-progress:');
    expect(workflow).toContain('pnpm run ci');
    expect(workflow).toContain('docker build');
    expect(workflow).toContain('ops/ci/proof-container-hardening.sh');
    expect(workflow).toContain('ops/ci/proof-deploy-rollback.sh');
    expect(workflow).not.toMatch(/uses:\s+\S+@v\d/);
  });

  it('keeps staging manual, checksummed, host-key pinned, and image-ID rollback capable', async () => {
    const workflow = await source('.github/workflows/deploy-staging.yml');
    const deploy = await source('ops/deploy-staging.sh');
    const rollback = await source('ops/rollback-staging.sh');

    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).not.toMatch(/^\s+push:/m);
    expect(workflow).toContain('StrictHostKeyChecking=yes');
    expect(workflow).toContain('NVS_STAGING_SSH_KNOWN_HOSTS');
    expect(workflow).toContain('docker save "$image"');
    expect(workflow).toContain('NVS_IMAGE_ARCHIVE_SHA256');
    expect(workflow).not.toContain('ssh-keyscan');
    expect(workflow).not.toMatch(/uses:\s+\S+@v\d/);

    expect(deploy).toContain('previous_image_id=');
    expect(deploy).toContain('nvs-rollback:');
    expect(deploy).toContain('Image archive checksum mismatch');
    expect(deploy).toContain('Loaded image metadata does not match the requested SHA.');
    expect(deploy).toContain('Restoring previously active image');
    expect(deploy).toContain('immutable image ID');
    expect(deploy).toContain('ROLLBACK_VERIFY_SCRIPT');
    expect(deploy).toContain('prune_rollback_tags');
    expect(deploy).not.toContain('docker compose down');
    expect(rollback).toContain('Rollback image metadata does not match the requested SHA.');
    expect(rollback).toContain('Manual rollback verified');
  });

  it('mounts server-owned configuration with a read-only root and fixed runtime UID', async () => {
    const compose = await source('docker-compose.staging.yml');
    const localCompose = await source('compose.yml');
    const image = await source('Dockerfile');
    const environmentExample = await source('.env.example');
    const apiPackage = await source('apps/api/package.json');
    const bootstrap = await source('ops/bootstrap-staging.md');
    const containerProof = await source('ops/ci/proof-container-hardening.sh');
    const rollbackProof = await source('ops/ci/proof-deploy-rollback.sh');

    expect(compose).toContain('image: ${NVS_IMAGE:');
    expect(compose).toContain('read_only: true');
    expect(compose).toContain('./config:/app/config:ro');
    expect(compose).toContain('./data:/var/lib/nvs');
    expect(compose).toContain('127.0.0.1:${NVS_HOST_PORT:-4100}:4100');
    expect(compose).toContain('networks:');
    expect(compose).toContain('- niles-internal');
    expect(compose).toContain('external: true');
    expect(compose).toContain('name: ${NVS_NILES_DOCKER_NETWORK:-bridge}');
    expect(compose).not.toContain('network_mode: host');
    expect(compose).not.toMatch(/3002:\d+/);
    expect(environmentExample).toContain('NVS_NILES_DOCKER_NETWORK=bridge');
    expect(environmentExample).toContain('grc-platform_grc-staging-network');
    expect(localCompose).toContain('read_only: true');
    expect(image).toContain('USER 10001:10001');
    expect(image).toContain('groupadd --gid 10001 nvs');
    expect(image).toContain('chown 10001:10001 /var/lib/nvs');
    expect(image).not.toContain('chown -R');
    expect(image).toContain('NVS_BUILD_SHA');
    expect(apiPackage).toContain('"@fastify/static": "10.1.0"');
    expect(environmentExample).not.toMatch(/^NVS_CREDENTIAL_[A-Z0-9_]+=(?!\s*$).+/m);
    expect(bootstrap).toContain('nvsdeploy:10001');
    expect(bootstrap).toContain('NVS_NILES_DOCKER_NETWORK=grc-platform_grc-staging-network');
    expect(bootstrap).toContain('http://backend:3002');
    expect(bootstrap).toContain('docker network inspect grc-platform_grc-staging-network');
    expect(bootstrap).toContain('Authentication preflight is the explicit connectivity');
    expect(bootstrap).toContain('sudo tar --create --gzip');
    expect(bootstrap).toContain('chmod 0600');
    expect(containerProof).toContain('nvsdeploy:10001');
    expect(containerProof).toContain('LOCAL_CONFIGURATION_UNAVAILABLE');
    expect(containerProof).not.toContain('chmod -R a+rX');
    expect(rollbackProof).toContain('Same-SHA collision requires distinct image IDs');
    expect(rollbackProof).toContain('IMAGE_ID_A');
    expect(rollbackProof).toContain('IMAGE_ID_B');
  });
});
