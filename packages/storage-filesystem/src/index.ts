import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  SAFE_ID_PATTERN,
  actorProfileV1Schema,
  businessBlueprintV1Schema,
  environmentDefinitionV1Schema,
  environmentActorMapV1Schema,
  evidenceManifestV1Schema,
  executablePlanV1Schema,
  parseActorProfile,
  parseBusinessBlueprint,
  parseEnvironmentDefinition,
  parseEnvironmentActorMap,
  runRecordV1Schema,
  type ActorPersona,
  type ActorProfileV1,
  type BusinessBlueprintV1,
  type EnvironmentDefinitionV1,
  type EnvironmentActorMapV1,
  type EvidenceManifestV1,
  type ExecutablePlanV1,
  type RunRecordV1,
} from '@nvs/contracts';
import type {
  ActorProfileRepository,
  ActorProfileSet,
  EnvironmentRepository,
  RunBundle,
  RunBundleRepository,
  ScenarioRepository,
} from '@nvs/core';
import { serializeForPersistence, sha256 } from '@nvs/domain';
import { parse as parseYaml } from 'yaml';

export class UnsafeIdentifierError extends Error {
  constructor() {
    super('Unsafe identifier or path.');
    this.name = 'UnsafeIdentifierError';
  }
}

export class StorageCorruptionError extends Error {
  constructor(kind: string, fileName: string) {
    super(`${kind} data is invalid or corrupted: ${path.basename(fileName)}`);
    this.name = 'StorageCorruptionError';
  }
}

export class RunIdAlreadyExistsError extends Error {
  readonly code = 'RUN_ID_ALREADY_EXISTS';
  readonly category = 'PERSISTENCE';
  readonly retryable = false;

  constructor() {
    super('A run with this identifier already exists.');
    this.name = 'RunIdAlreadyExistsError';
  }
}

function assertSafeId(id: string): void {
  if (!SAFE_ID_PATTERN.test(id)) {
    throw new UnsafeIdentifierError();
  }
}

function safeChild(root: string, ...segments: string[]): string {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, ...segments);
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new UnsafeIdentifierError();
  }
  return resolved;
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

async function yamlFiles(root: string, recursive: boolean): Promise<string[]> {
  const visit = async (directory: string): Promise<string[]> => {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (isMissing(error)) {
        return [];
      }
      throw error;
    }
    const files: string[] = [];
    for (const entry of entries) {
      const child = safeChild(directory, entry.name);
      if (entry.isDirectory() && recursive) {
        files.push(...(await visit(child)));
      } else if (entry.isFile() && /\.ya?ml$/i.test(entry.name)) {
        files.push(child);
      }
    }
    return files.sort();
  };
  return visit(root);
}

async function readYaml(file: string): Promise<unknown> {
  return parseYaml(await readFile(file, 'utf8'));
}

export class FilesystemEnvironmentRepository implements EnvironmentRepository {
  constructor(private readonly root: string) {}

  async list(): Promise<EnvironmentDefinitionV1[]> {
    const definitions: EnvironmentDefinitionV1[] = [];
    for (const file of await yamlFiles(this.root, false)) {
      try {
        definitions.push(parseEnvironmentDefinition(await readYaml(file)));
      } catch {
        throw new StorageCorruptionError('Environment', file);
      }
    }
    return definitions.sort((left, right) => left.id.localeCompare(right.id));
  }

  async get(id: string): Promise<EnvironmentDefinitionV1 | undefined> {
    assertSafeId(id);
    return (await this.list()).find((environment) => environment.id === id);
  }
}

export class FilesystemScenarioRepository implements ScenarioRepository {
  constructor(private readonly root: string) {}

  async list(): Promise<BusinessBlueprintV1[]> {
    const scenarios: BusinessBlueprintV1[] = [];
    for (const file of await yamlFiles(this.root, true)) {
      try {
        scenarios.push(parseBusinessBlueprint(await readYaml(file)));
      } catch {
        throw new StorageCorruptionError('Scenario', file);
      }
    }
    return scenarios.sort((left, right) => left.id.localeCompare(right.id));
  }

  async get(id: string): Promise<BusinessBlueprintV1 | undefined> {
    assertSafeId(id);
    return (await this.list()).find((scenario) => scenario.id === id);
  }
}

const ACTOR_PERSONA_ORDER: ActorPersona[] = [
  'requester',
  'service-desk-agent',
  'incident-manager',
  'tenant-admin',
  'cross-tenant-agent',
];

export class FilesystemActorProfileRepository implements ActorProfileRepository {
  constructor(private readonly root: string) {}

  async getForEnvironment(environmentId: string): Promise<ActorProfileSet> {
    assertSafeId(environmentId);
    const mappingRoot = safeChild(this.root, 'mappings');
    const profileRoot = safeChild(this.root, 'profiles');
    const mappings: Array<{ file: string; value: EnvironmentActorMapV1 }> = [];
    for (const file of await yamlFiles(mappingRoot, false)) {
      try {
        mappings.push({ file, value: parseEnvironmentActorMap(await readYaml(file)) });
      } catch {
        throw new StorageCorruptionError('Actor mapping', file);
      }
    }
    const mappingEntry = mappings.find(({ value }) => value.environmentId === environmentId);
    if (!mappingEntry) {
      throw new Error(`Actor mapping for environment "${environmentId}" was not found.`);
    }

    const profiles: ActorProfileV1[] = [];
    for (const file of await yamlFiles(profileRoot, false)) {
      try {
        profiles.push(parseActorProfile(await readYaml(file)));
      } catch {
        throw new StorageCorruptionError('Actor profile', file);
      }
    }
    const profilesById = new Map(profiles.map((profile) => [profile.id, profile]));
    const orderedProfiles = ACTOR_PERSONA_ORDER.map((persona) => {
      const profileId = mappingEntry.value.actors[persona];
      const profile = profilesById.get(profileId);
      if (
        !profile ||
        profile.persona !== persona ||
        profile.environmentId !== mappingEntry.value.environmentId
      ) {
        throw new StorageCorruptionError('Actor mapping', mappingEntry.file);
      }
      return profile;
    });
    if (new Set(orderedProfiles.map((profile) => profile.id)).size !== orderedProfiles.length) {
      throw new StorageCorruptionError('Actor mapping', mappingEntry.file);
    }

    return {
      mapping: mappingEntry.value,
      profiles: orderedProfiles,
    };
  }
}

type BundleDocument = 'plan.json' | 'run.json' | 'evidence.json';

export interface BundlePersistenceHooks {
  afterWrite?(document: BundleDocument): Promise<void> | void;
  beforeCommit?(): Promise<void> | void;
}

interface PreparedBundle {
  run: RunRecordV1;
  plan: ExecutablePlanV1;
  evidenceManifest: EvidenceManifestV1;
  bytes: Record<BundleDocument, string>;
  commitMarkerBytes: string;
}

interface CommittedBundle {
  run: RunRecordV1;
  plan: ExecutablePlanV1;
  evidenceManifest: EvidenceManifestV1;
}

let stagingSequence = 0;

function withoutSha256(entry: EvidenceManifestV1['entries'][number]) {
  return {
    id: entry.id,
    kind: entry.kind,
    path: entry.path,
    mediaType: entry.mediaType,
  };
}

function prepareBundle(bundle: RunBundle): PreparedBundle {
  assertSafeId(bundle.run.runId);
  const plan = executablePlanV1Schema.parse(bundle.plan);
  const baseRun = runRecordV1Schema.parse(bundle.run);
  const baseManifest = evidenceManifestV1Schema.parse(bundle.evidenceManifest);
  if (
    baseRun.runId !== baseManifest.runId ||
    baseRun.planId !== plan.id ||
    baseRun.scenario.id !== plan.scenario.id ||
    baseRun.scenario.version !== plan.scenario.version
  ) {
    throw new Error('Run bundle documents do not describe the same run.');
  }

  const planBytes = serializeForPersistence(plan);
  const planHash = sha256(planBytes);
  const runWithExactPlanHash = {
    ...baseRun,
    evidence: baseRun.evidence.map((entry) => {
      const withoutHash = withoutSha256(entry);
      return entry.id === 'compiled-plan' ? { ...withoutHash, sha256: planHash } : withoutHash;
    }),
  };
  const runBytes = serializeForPersistence(runWithExactPlanHash);
  const runHash = sha256(runBytes);
  const manifestWithExactHashes = {
    ...baseManifest,
    entries: baseManifest.entries.map((entry) => {
      const withoutHash = withoutSha256(entry);
      if (entry.id === 'compiled-plan') {
        return { ...withoutHash, sha256: planHash };
      }
      if (entry.id === 'run-record') {
        return { ...withoutHash, sha256: runHash };
      }
      return withoutHash;
    }),
  };
  const evidenceBytes = serializeForPersistence(manifestWithExactHashes);
  const commitMarkerBytes = serializeForPersistence({
    schemaVersion: 'nvs.run-bundle-commit/v1',
    hashes: {
      'plan.json': planHash,
      'run.json': runHash,
      'evidence.json': sha256(evidenceBytes),
    },
  });

  const persistedPlan = executablePlanV1Schema.parse(JSON.parse(planBytes));
  const persistedRun = runRecordV1Schema.parse(JSON.parse(runBytes));
  const persistedManifest = evidenceManifestV1Schema.parse(JSON.parse(evidenceBytes));

  return {
    run: persistedRun,
    plan: persistedPlan,
    evidenceManifest: persistedManifest,
    bytes: {
      'plan.json': planBytes,
      'run.json': runBytes,
      'evidence.json': evidenceBytes,
    },
    commitMarkerBytes,
  };
}

function parseCommitMarker(value: string): Record<BundleDocument, string> {
  const parsed = JSON.parse(value) as {
    schemaVersion?: unknown;
    hashes?: Partial<Record<BundleDocument, unknown>>;
  };
  const hashes = parsed.hashes;
  if (
    parsed.schemaVersion !== 'nvs.run-bundle-commit/v1' ||
    !hashes ||
    !['plan.json', 'run.json', 'evidence.json'].every(
      (document) =>
        typeof hashes[document as BundleDocument] === 'string' &&
        /^[a-f0-9]{64}$/.test(hashes[document as BundleDocument] as string),
    )
  ) {
    throw new Error('Invalid run bundle commit marker.');
  }
  return hashes as Record<BundleDocument, string>;
}

function isAlreadyExists(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    ['EEXIST', 'ENOTEMPTY'].includes(String(error.code))
  );
}

export class FilesystemRunBundleRepository implements RunBundleRepository {
  constructor(
    private readonly artifactRoot: string,
    private readonly hooks: BundlePersistenceHooks = {},
  ) {}

  async saveBundle(bundle: RunBundle): Promise<RunRecordV1> {
    const prepared = prepareBundle(bundle);
    const runsRoot = safeChild(this.artifactRoot, 'runs');
    const finalDirectory = safeChild(runsRoot, prepared.run.runId);
    const stagingRoot = safeChild(runsRoot, '.staging');
    stagingSequence += 1;
    const stagingDirectory = safeChild(
      stagingRoot,
      `${prepared.run.runId}-${process.pid}-${stagingSequence}`,
    );
    let finalDirectoryCreated = false;

    await mkdir(stagingRoot, { recursive: true });
    await mkdir(stagingDirectory);
    try {
      for (const document of ['plan.json', 'run.json', 'evidence.json'] as const) {
        await writeFile(safeChild(stagingDirectory, document), prepared.bytes[document], {
          encoding: 'utf8',
          flag: 'wx',
        });
        await this.hooks.afterWrite?.(document);
      }
      await writeFile(safeChild(stagingDirectory, '.committed'), prepared.commitMarkerBytes, {
        encoding: 'utf8',
        flag: 'wx',
      });
      await this.hooks.beforeCommit?.();

      try {
        await mkdir(finalDirectory);
        finalDirectoryCreated = true;
      } catch (error) {
        if (isAlreadyExists(error)) {
          throw new RunIdAlreadyExistsError();
        }
        throw error;
      }

      for (const document of ['plan.json', 'run.json', 'evidence.json'] as const) {
        await rename(safeChild(stagingDirectory, document), safeChild(finalDirectory, document));
      }
      await rename(
        safeChild(stagingDirectory, '.committed'),
        safeChild(finalDirectory, '.committed'),
      );
      await rm(stagingDirectory, { recursive: true, force: true }).catch(() => undefined);
      return prepared.run;
    } catch (error) {
      await rm(stagingDirectory, { recursive: true, force: true });
      if (finalDirectoryCreated) {
        await rm(finalDirectory, { recursive: true, force: true });
      }
      throw error;
    }
  }

  private async readCommitted(id: string): Promise<CommittedBundle | undefined> {
    assertSafeId(id);
    const directory = safeChild(this.artifactRoot, 'runs', id);
    let marker: string;
    try {
      marker = await readFile(safeChild(directory, '.committed'), 'utf8');
    } catch (error) {
      if (isMissing(error)) {
        return undefined;
      }
      throw error;
    }
    let committedHashes: Record<BundleDocument, string>;
    try {
      committedHashes = parseCommitMarker(marker);
    } catch {
      throw new StorageCorruptionError('Run bundle', safeChild(directory, '.committed'));
    }

    try {
      const [runBytes, planBytes, evidenceBytes] = await Promise.all([
        readFile(safeChild(directory, 'run.json'), 'utf8'),
        readFile(safeChild(directory, 'plan.json'), 'utf8'),
        readFile(safeChild(directory, 'evidence.json'), 'utf8'),
      ]);
      const run = runRecordV1Schema.parse(JSON.parse(runBytes));
      const plan = executablePlanV1Schema.parse(JSON.parse(planBytes));
      const evidenceManifest = evidenceManifestV1Schema.parse(JSON.parse(evidenceBytes));
      const runEntry = evidenceManifest.entries.find((entry) => entry.id === 'run-record');
      const planEntry = evidenceManifest.entries.find((entry) => entry.id === 'compiled-plan');
      if (
        run.runId !== id ||
        evidenceManifest.runId !== id ||
        run.planId !== plan.id ||
        runEntry?.sha256 !== sha256(runBytes) ||
        planEntry?.sha256 !== sha256(planBytes) ||
        committedHashes['run.json'] !== sha256(runBytes) ||
        committedHashes['plan.json'] !== sha256(planBytes) ||
        committedHashes['evidence.json'] !== sha256(evidenceBytes)
      ) {
        throw new Error('Run bundle integrity verification failed.');
      }
      return { run, plan, evidenceManifest };
    } catch {
      throw new StorageCorruptionError('Run bundle', safeChild(directory, 'run.json'));
    }
  }

  async list(): Promise<RunRecordV1[]> {
    const runsRoot = safeChild(this.artifactRoot, 'runs');
    let entries;
    try {
      entries = await readdir(runsRoot, { withFileTypes: true });
    } catch (error) {
      if (isMissing(error)) {
        return [];
      }
      throw error;
    }
    const runs: RunRecordV1[] = [];
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.isDirectory() || !SAFE_ID_PATTERN.test(entry.name)) {
        continue;
      }
      try {
        const run = await this.get(entry.name);
        if (run) {
          runs.push(run);
        }
      } catch (error) {
        if (!(error instanceof StorageCorruptionError)) {
          throw error;
        }
      }
    }
    return runs.sort((left, right) =>
      right.timestamps.createdAt.localeCompare(left.timestamps.createdAt),
    );
  }

  async get(id: string): Promise<RunRecordV1 | undefined> {
    return (await this.readCommitted(id))?.run;
  }

  async getPlan(id: string): Promise<ExecutablePlanV1 | undefined> {
    return (await this.readCommitted(id))?.plan;
  }

  async getEvidence(runId: string): Promise<EvidenceManifestV1 | undefined> {
    return (await this.readCommitted(runId))?.evidenceManifest;
  }
}

export const storageSchemas = {
  actorProfile: actorProfileV1Schema,
  environmentActorMap: environmentActorMapV1Schema,
  environment: environmentDefinitionV1Schema,
  scenario: businessBlueprintV1Schema,
};
