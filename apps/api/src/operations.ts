import { constants } from 'node:fs';
import { access, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  FilesystemActorProfileRepository,
  FilesystemEnvironmentRepository,
  FilesystemScenarioRepository,
} from '@nvs/storage-filesystem';

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

type ReadinessCheck = 'ok' | 'blocked';
type ReadinessErrorCode =
  'LOCAL_CONFIGURATION_UNAVAILABLE' | 'LOCAL_CONFIGURATION_INVALID' | 'LOCAL_STORAGE_UNAVAILABLE';

export interface ReadinessResult {
  schemaVersion: 'nvs.readiness/v1';
  status: 'ready' | 'blocked';
  checks: {
    configuration: ReadinessCheck;
    storage: ReadinessCheck;
  };
  error?: {
    category: 'ENVIRONMENT';
    code: ReadinessErrorCode;
    message: string;
    retryable: boolean;
  };
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

function blockedReadiness(
  code: ReadinessErrorCode,
  configuration: ReadinessCheck,
  storage: ReadinessCheck,
): ReadinessResult {
  const message =
    code === 'LOCAL_STORAGE_UNAVAILABLE'
      ? 'Required local NVS storage is unavailable.'
      : code === 'LOCAL_CONFIGURATION_INVALID'
        ? 'Required local NVS configuration is invalid or incomplete.'
        : 'Required local NVS configuration is unavailable.';
  return {
    schemaVersion: 'nvs.readiness/v1',
    status: 'blocked',
    checks: { configuration, storage },
    error: {
      category: 'ENVIRONMENT',
      code,
      message,
      retryable: false,
    },
  };
}

async function configurationError(paths: RuntimePaths): Promise<ReadinessErrorCode | undefined> {
  const actorsRoot = path.join(paths.configDir, 'actors');
  const environmentsRoot = path.join(paths.configDir, 'environments');
  const scenariosRoot = path.join(paths.configDir, 'scenarios');
  try {
    await Promise.all([
      access(actorsRoot, constants.R_OK),
      access(environmentsRoot, constants.R_OK),
      access(scenariosRoot, constants.R_OK),
    ]);
  } catch {
    return 'LOCAL_CONFIGURATION_UNAVAILABLE';
  }

  try {
    const environmentRepository = new FilesystemEnvironmentRepository(environmentsRoot);
    const scenarioRepository = new FilesystemScenarioRepository(scenariosRoot);
    const actorRepository = new FilesystemActorProfileRepository(actorsRoot);
    const [environments, scenarios] = await Promise.all([
      environmentRepository.list(),
      scenarioRepository.list(),
    ]);
    if (environments.length === 0 || scenarios.length === 0) {
      return 'LOCAL_CONFIGURATION_INVALID';
    }
    if (new Set(environments.map(({ id }) => id)).size !== environments.length) {
      return 'LOCAL_CONFIGURATION_INVALID';
    }
    if (new Set(scenarios.map(({ id }) => id)).size !== scenarios.length) {
      return 'LOCAL_CONFIGURATION_INVALID';
    }
    await actorRepository.validateConfiguration(
      environments.map(({ id }) => id),
      environments
        .filter(({ enabled, kind }) => enabled && kind !== 'production')
        .map(({ id }) => id),
    );
  } catch {
    return 'LOCAL_CONFIGURATION_INVALID';
  }
  return undefined;
}

async function storageIsWritable(paths: RuntimePaths): Promise<boolean> {
  const readinessFile = path.join(paths.dataDir, `.nvs-readiness-${process.pid}`);
  try {
    await mkdir(paths.dataDir, { recursive: true });
    await writeFile(readinessFile, 'ready\n', { encoding: 'utf8', flag: 'w' });
    await access(paths.dataDir, constants.R_OK | constants.W_OK);
    await rm(readinessFile, { force: true });
  } catch {
    await rm(readinessFile, { force: true }).catch(() => undefined);
    return false;
  }
  return true;
}

export async function checkLocalReadiness(paths: RuntimePaths): Promise<ReadinessResult> {
  const [configError, storageWritable] = await Promise.all([
    configurationError(paths),
    storageIsWritable(paths),
  ]);
  if (configError) {
    return blockedReadiness(configError, 'blocked', storageWritable ? 'ok' : 'blocked');
  }
  if (!storageWritable) {
    return blockedReadiness('LOCAL_STORAGE_UNAVAILABLE', 'ok', 'blocked');
  }
  return {
    schemaVersion: 'nvs.readiness/v1',
    status: 'ready',
    checks: { configuration: 'ok', storage: 'ok' },
  };
}
