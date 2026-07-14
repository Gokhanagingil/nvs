import { constants } from 'node:fs';
import { access, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const NVS_OPERATIONAL_CONTRACT_VERSION = 'nvs.operational/v1';

export interface RuntimePaths {
  configDir: string;
  dataDir: string;
  webDir: string;
}

export interface BuildInformation {
  schemaVersion: 'nvs.version/v1';
  buildSha: string;
  buildTimestamp: string;
  releaseVersion: string;
  nodeVersion: string;
  contractVersion: string;
}

export function resolveRuntimePaths(rootDir: string): RuntimePaths {
  return {
    configDir: path.resolve(process.env['NVS_CONFIG_DIR'] ?? rootDir),
    dataDir: path.resolve(process.env['NVS_DATA_DIR'] ?? path.join(rootDir, 'artifacts')),
    webDir: path.resolve(process.env['NVS_WEB_DIR'] ?? path.join(rootDir, 'apps', 'web', 'dist')),
  };
}

function safeBuildValue(value: string | undefined, fallback: string): string {
  const normalized = value?.trim();
  if (!normalized || normalized.length > 160 || /[\r\n]/.test(normalized)) {
    return fallback;
  }
  return normalized;
}

export function buildInformation(): BuildInformation {
  return {
    schemaVersion: 'nvs.version/v1',
    buildSha: safeBuildValue(process.env['NVS_BUILD_SHA'], 'unknown'),
    buildTimestamp: safeBuildValue(process.env['NVS_BUILD_TIMESTAMP'], 'unknown'),
    releaseVersion: safeBuildValue(process.env['NVS_RELEASE_VERSION'], '0.1.0'),
    nodeVersion: process.version,
    contractVersion: NVS_OPERATIONAL_CONTRACT_VERSION,
  };
}

export async function checkLocalReadiness(paths: RuntimePaths): Promise<{
  schemaVersion: 'nvs.readiness/v1';
  status: 'ready' | 'blocked';
  checks: {
    configuration: 'ok' | 'blocked';
    storage: 'ok' | 'blocked';
  };
  error?: {
    category: 'ENVIRONMENT';
    code: 'LOCAL_CONFIGURATION_UNAVAILABLE' | 'LOCAL_STORAGE_UNAVAILABLE';
    message: string;
    retryable: boolean;
  };
}> {
  try {
    await Promise.all([
      access(path.join(paths.configDir, 'environments'), constants.R_OK),
      access(path.join(paths.configDir, 'scenarios'), constants.R_OK),
    ]);
  } catch {
    return {
      schemaVersion: 'nvs.readiness/v1',
      status: 'blocked',
      checks: { configuration: 'blocked', storage: 'blocked' },
      error: {
        category: 'ENVIRONMENT',
        code: 'LOCAL_CONFIGURATION_UNAVAILABLE',
        message: 'Required local NVS configuration is unavailable.',
        retryable: false,
      },
    };
  }

  const readinessFile = path.join(paths.dataDir, `.nvs-readiness-${process.pid}`);
  try {
    await mkdir(paths.dataDir, { recursive: true });
    await writeFile(readinessFile, 'ready\n', { encoding: 'utf8', flag: 'w' });
    await access(paths.dataDir, constants.R_OK | constants.W_OK);
    await rm(readinessFile, { force: true });
  } catch {
    await rm(readinessFile, { force: true }).catch(() => undefined);
    return {
      schemaVersion: 'nvs.readiness/v1',
      status: 'blocked',
      checks: { configuration: 'ok', storage: 'blocked' },
      error: {
        category: 'ENVIRONMENT',
        code: 'LOCAL_STORAGE_UNAVAILABLE',
        message: 'Required local NVS storage is unavailable.',
        retryable: false,
      },
    };
  }

  return {
    schemaVersion: 'nvs.readiness/v1',
    status: 'ready',
    checks: { configuration: 'ok', storage: 'ok' },
  };
}
