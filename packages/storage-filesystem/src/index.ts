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
  liveRunCheckpointV1Schema,
  nilesIncidentFixtureV1Schema,
  parseActorProfile,
  parseBusinessBlueprint,
  parseEnvironmentDefinition,
  parseEnvironmentActorMap,
  parseNilesIncidentFixture,
  resourceInventoryV1Schema,
  runRecordSchema,
  stepObservationV1Schema,
  type ActorPersona,
  type ActorProfileV1,
  type BusinessBlueprintV1,
  type EnvironmentDefinitionV1,
  type EnvironmentActorMapV1,
  type EvidenceManifestV1,
  type ExecutablePlanV1,
  type LiveRunCheckpointV1,
  type NilesIncidentFixtureV1,
  type ResourceInventoryV1,
  type RunRecord,
  type StepObservationV1,
} from '@nvs/contracts';
import type {
  ActorProfileRepository,
  ActorProfileSet,
  EnvironmentRepository,
  LiveRunState,
  LiveRunStateRepository,
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

interface ActorConfiguration {
  mappings: Array<{ file: string; value: EnvironmentActorMapV1 }>;
  profiles: ActorProfileV1[];
}

export class FilesystemActorProfileRepository implements ActorProfileRepository {
  constructor(private readonly root: string) {}

  private async loadConfiguration(): Promise<ActorConfiguration> {
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

    const profiles: ActorProfileV1[] = [];
    for (const file of await yamlFiles(profileRoot, false)) {
      try {
        profiles.push(parseActorProfile(await readYaml(file)));
      } catch {
        throw new StorageCorruptionError('Actor profile', file);
      }
    }
    if (new Set(mappings.map(({ value }) => value.environmentId)).size !== mappings.length) {
      throw new StorageCorruptionError('Actor mapping', mappingRoot);
    }
    if (new Set(profiles.map((profile) => profile.id)).size !== profiles.length) {
      throw new StorageCorruptionError('Actor profile', profileRoot);
    }
    return { mappings, profiles };
  }

  private profilesForMapping(
    mappingEntry: { file: string; value: EnvironmentActorMapV1 },
    profiles: ActorProfileV1[],
  ): ActorProfileV1[] {
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

    return orderedProfiles;
  }

  async validateConfiguration(
    knownEnvironmentIds: readonly string[],
    requiredEnvironmentIds: readonly string[],
  ): Promise<void> {
    const { mappings, profiles } = await this.loadConfiguration();
    const knownIds = new Set(knownEnvironmentIds);
    for (const mapping of mappings) {
      if (!knownIds.has(mapping.value.environmentId)) {
        throw new StorageCorruptionError('Actor mapping', mapping.file);
      }
      this.profilesForMapping(mapping, profiles);
    }
    const mappedEnvironmentIds = new Set(mappings.map(({ value }) => value.environmentId));
    for (const environmentId of requiredEnvironmentIds) {
      assertSafeId(environmentId);
      if (!mappedEnvironmentIds.has(environmentId)) {
        throw new StorageCorruptionError(
          'Actor mapping',
          safeChild(this.root, 'mappings', `${environmentId}.yaml`),
        );
      }
    }
  }

  async getForEnvironment(environmentId: string): Promise<ActorProfileSet> {
    assertSafeId(environmentId);
    const { mappings, profiles } = await this.loadConfiguration();
    const mappingEntry = mappings.find(({ value }) => value.environmentId === environmentId);
    if (!mappingEntry) {
      throw new Error(`Actor mapping for environment "${environmentId}" was not found.`);
    }
    const orderedProfiles = this.profilesForMapping(mappingEntry, profiles);

    return {
      mapping: mappingEntry.value,
      profiles: orderedProfiles,
    };
  }
}

type BundleDocument =
  | 'plan.json'
  | 'run.json'
  | 'evidence.json'
  | 'inventory.json'
  | 'observations.json'
  | 'checkpoint.json';
const BASE_BUNDLE_DOCUMENTS = ['plan.json', 'run.json', 'evidence.json'] as const;
const EXTRA_BUNDLE_DOCUMENTS = ['inventory.json', 'observations.json', 'checkpoint.json'] as const;
const ALL_BUNDLE_DOCUMENTS = [...BASE_BUNDLE_DOCUMENTS, ...EXTRA_BUNDLE_DOCUMENTS] as const;

export interface BundlePersistenceHooks {
  afterWrite?(document: BundleDocument): Promise<void> | void;
  beforeCommit?(): Promise<void> | void;
  beforePromote?(document: BundleDocument | '.committed'): Promise<void> | void;
}

type LiveStateDocument = 'plan.json' | 'checkpoint.json' | 'inventory.json' | 'observations.json';

export interface LiveStatePersistenceHooks {
  afterWrite?(document: LiveStateDocument, state: LiveRunState): Promise<void> | void;
}

interface PreparedBundle {
  run: RunRecord;
  plan: ExecutablePlanV1;
  evidenceManifest: EvidenceManifestV1;
  bytes: Partial<Record<BundleDocument, string>> &
    Record<(typeof BASE_BUNDLE_DOCUMENTS)[number], string>;
  commitMarkerBytes: string;
}

interface CommittedBundle {
  run: RunRecord;
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
  const baseRun = runRecordSchema.parse(bundle.run);
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
  const extraBytes: Partial<Record<BundleDocument, string>> = {};
  const extraHashes: Partial<Record<BundleDocument, string>> = {};
  if (bundle.resourceInventory) {
    const inventoryBytes = serializeForPersistence(
      resourceInventoryV1Schema.parse(bundle.resourceInventory),
    );
    extraBytes['inventory.json'] = inventoryBytes;
    extraHashes['inventory.json'] = sha256(inventoryBytes);
  }
  if (bundle.observations) {
    const observationBytes = serializeForPersistence(
      bundle.observations.map((observation) => stepObservationV1Schema.parse(observation)),
    );
    extraBytes['observations.json'] = observationBytes;
    extraHashes['observations.json'] = sha256(observationBytes);
  }
  if (bundle.checkpoint) {
    const checkpointBytes = serializeForPersistence(
      liveRunCheckpointV1Schema.parse(bundle.checkpoint),
    );
    extraBytes['checkpoint.json'] = checkpointBytes;
    extraHashes['checkpoint.json'] = sha256(checkpointBytes);
  }
  const hashByDocument: Partial<Record<BundleDocument, string>> = {
    'plan.json': planHash,
    ...extraHashes,
  };
  const runWithExactPlanHash = {
    ...baseRun,
    evidence: baseRun.evidence.map((entry) => {
      const withoutHash = withoutSha256(entry);
      const document = path.basename(entry.path) as BundleDocument;
      const hash = hashByDocument[document];
      return hash ? { ...withoutHash, sha256: hash } : withoutHash;
    }),
  };
  const runBytes = serializeForPersistence(runWithExactPlanHash);
  const runHash = sha256(runBytes);
  hashByDocument['run.json'] = runHash;
  const manifestWithExactHashes = {
    ...baseManifest,
    entries: baseManifest.entries.map((entry) => {
      const withoutHash = withoutSha256(entry);
      const document = path.basename(entry.path) as BundleDocument;
      const hash = hashByDocument[document];
      return hash ? { ...withoutHash, sha256: hash } : withoutHash;
    }),
  };
  const evidenceBytes = serializeForPersistence(manifestWithExactHashes);
  hashByDocument['evidence.json'] = sha256(evidenceBytes);
  const commitMarkerBytes = serializeForPersistence({
    schemaVersion: 'nvs.run-bundle-commit/v1',
    hashes: hashByDocument,
  });

  const persistedPlan = executablePlanV1Schema.parse(JSON.parse(planBytes));
  const persistedRun = runRecordSchema.parse(JSON.parse(runBytes));
  const persistedManifest = evidenceManifestV1Schema.parse(JSON.parse(evidenceBytes));

  return {
    run: persistedRun,
    plan: persistedPlan,
    evidenceManifest: persistedManifest,
    bytes: {
      'plan.json': planBytes,
      'run.json': runBytes,
      'evidence.json': evidenceBytes,
      ...extraBytes,
    },
    commitMarkerBytes,
  };
}

function parseCommitMarker(
  value: string,
): Partial<Record<BundleDocument, string>> &
  Record<(typeof BASE_BUNDLE_DOCUMENTS)[number], string> {
  const parsed = JSON.parse(value) as {
    schemaVersion?: unknown;
    hashes?: Partial<Record<BundleDocument, unknown>>;
  };
  const hashes = parsed.hashes;
  if (
    parsed.schemaVersion !== 'nvs.run-bundle-commit/v1' ||
    !hashes ||
    !BASE_BUNDLE_DOCUMENTS.every(
      (document) => typeof hashes[document] === 'string' && /^[a-f0-9]{64}$/.test(hashes[document]),
    )
  ) {
    throw new Error('Invalid run bundle commit marker.');
  }
  for (const [document, hash] of Object.entries(hashes)) {
    if (
      !(ALL_BUNDLE_DOCUMENTS as readonly string[]).includes(document) ||
      typeof hash !== 'string' ||
      !/^[a-f0-9]{64}$/.test(hash)
    ) {
      throw new Error('Invalid run bundle commit marker.');
    }
  }
  return hashes as Partial<Record<BundleDocument, string>> &
    Record<(typeof BASE_BUNDLE_DOCUMENTS)[number], string>;
}

function isAlreadyExists(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    ['EEXIST', 'ENOTEMPTY'].includes(String(error.code))
  );
}

export class FilesystemRunBundleRepository implements RunBundleRepository {
  private readonly reservedRunIds = new Set<string>();

  constructor(
    private readonly artifactRoot: string,
    private readonly hooks: BundlePersistenceHooks = {},
  ) {}

  async reserveRunId(runId: string): Promise<void> {
    assertSafeId(runId);
    const runsRoot = safeChild(this.artifactRoot, 'runs');
    const finalDirectory = safeChild(runsRoot, runId);
    const inflightDirectory = safeChild(runsRoot, '.inflight', runId);
    await mkdir(runsRoot, { recursive: true });
    try {
      await readdir(inflightDirectory);
      throw new RunIdAlreadyExistsError();
    } catch (error) {
      if (!isMissing(error)) {
        throw error;
      }
    }
    try {
      await mkdir(finalDirectory);
      await writeFile(
        safeChild(finalDirectory, '.reserved'),
        serializeForPersistence({
          schemaVersion: 'nvs.run-namespace-reservation/v1',
          runId,
          reservedAt: new Date().toISOString(),
          pid: process.pid,
        }),
        { encoding: 'utf8', flag: 'wx' },
      );
      this.reservedRunIds.add(runId);
    } catch (error) {
      if (isAlreadyExists(error)) {
        throw new RunIdAlreadyExistsError();
      }
      await rm(finalDirectory, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  }

  async saveBundle(bundle: RunBundle): Promise<RunRecord> {
    const prepared = prepareBundle(bundle);
    const documents = ALL_BUNDLE_DOCUMENTS.filter((document) => prepared.bytes[document]);
    const runsRoot = safeChild(this.artifactRoot, 'runs');
    const finalDirectory = safeChild(runsRoot, prepared.run.runId);
    const stagingRoot = safeChild(runsRoot, '.staging');
    stagingSequence += 1;
    const stagingDirectory = safeChild(
      stagingRoot,
      `${prepared.run.runId}-${process.pid}-${stagingSequence}`,
    );
    let finalDirectoryCreated = false;
    const usingReservedDirectory = this.reservedRunIds.has(prepared.run.runId);

    await mkdir(stagingRoot, { recursive: true });
    await mkdir(stagingDirectory);
    try {
      for (const document of documents) {
        await writeFile(safeChild(stagingDirectory, document), prepared.bytes[document]!, {
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

      if (this.reservedRunIds.has(prepared.run.runId)) {
        try {
          await readFile(safeChild(finalDirectory, '.reserved'), 'utf8');
        } catch {
          throw new RunIdAlreadyExistsError();
        }
      } else {
        try {
          await mkdir(finalDirectory);
          finalDirectoryCreated = true;
        } catch (error) {
          if (isAlreadyExists(error)) {
            throw new RunIdAlreadyExistsError();
          }
          throw error;
        }
      }

      for (const document of documents) {
        await this.hooks.beforePromote?.(document);
        await rename(safeChild(stagingDirectory, document), safeChild(finalDirectory, document));
      }
      await this.hooks.beforePromote?.('.committed');
      await rename(
        safeChild(stagingDirectory, '.committed'),
        safeChild(finalDirectory, '.committed'),
      );
      if (usingReservedDirectory) {
        await rm(safeChild(finalDirectory, '.reserved'), { force: true }).catch(() => undefined);
        this.reservedRunIds.delete(prepared.run.runId);
      }
      await rm(stagingDirectory, { recursive: true, force: true }).catch(() => undefined);
      return prepared.run;
    } catch (error) {
      await rm(stagingDirectory, { recursive: true, force: true });
      if (finalDirectoryCreated || usingReservedDirectory) {
        await rm(finalDirectory, { recursive: true, force: true });
      }
      this.reservedRunIds.delete(prepared.run.runId);
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
    let committedHashes: Partial<Record<BundleDocument, string>> &
      Record<(typeof BASE_BUNDLE_DOCUMENTS)[number], string>;
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
      const run = runRecordSchema.parse(JSON.parse(runBytes));
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

  async list(): Promise<RunRecord[]> {
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
    const runs: RunRecord[] = [];
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

  async get(id: string): Promise<RunRecord | undefined> {
    return (await this.readCommitted(id))?.run;
  }

  async getPlan(id: string): Promise<ExecutablePlanV1 | undefined> {
    return (await this.readCommitted(id))?.plan;
  }

  async getEvidence(runId: string): Promise<EvidenceManifestV1 | undefined> {
    return (await this.readCommitted(runId))?.evidenceManifest;
  }

  private async readOptionalDocument(
    runId: string,
    document: BundleDocument,
  ): Promise<string | undefined> {
    assertSafeId(runId);
    const directory = safeChild(this.artifactRoot, 'runs', runId);
    let marker: string;
    try {
      marker = await readFile(safeChild(directory, '.committed'), 'utf8');
    } catch (error) {
      if (isMissing(error)) {
        return undefined;
      }
      throw error;
    }
    let committedHashes: Partial<Record<BundleDocument, string>>;
    try {
      committedHashes = parseCommitMarker(marker);
    } catch {
      throw new StorageCorruptionError('Run bundle', safeChild(directory, '.committed'));
    }
    const expectedHash = committedHashes[document];
    if (!expectedHash) {
      return undefined;
    }
    try {
      const bytes = await readFile(safeChild(directory, document), 'utf8');
      if (sha256(bytes) !== expectedHash) {
        throw new Error('Optional run artifact integrity verification failed.');
      }
      return bytes;
    } catch {
      throw new StorageCorruptionError('Run bundle', safeChild(directory, document));
    }
  }

  async getResourceInventory(runId: string): Promise<ResourceInventoryV1 | undefined> {
    const bytes = await this.readOptionalDocument(runId, 'inventory.json');
    return bytes ? resourceInventoryV1Schema.parse(JSON.parse(bytes)) : undefined;
  }

  async getStepObservations(runId: string): Promise<StepObservationV1[] | undefined> {
    const bytes = await this.readOptionalDocument(runId, 'observations.json');
    return bytes ? stepObservationV1Schema.array().parse(JSON.parse(bytes)) : undefined;
  }

  async getLiveCheckpoint(runId: string): Promise<LiveRunCheckpointV1 | undefined> {
    const bytes = await this.readOptionalDocument(runId, 'checkpoint.json');
    return bytes ? liveRunCheckpointV1Schema.parse(JSON.parse(bytes)) : undefined;
  }
}

let liveStateSequence = 0;

export class FilesystemLiveRunStateRepository implements LiveRunStateRepository {
  constructor(
    private readonly artifactRoot: string,
    private readonly hooks: LiveStatePersistenceHooks = {},
  ) {}

  private root(): string {
    return safeChild(this.artifactRoot, 'runs', '.inflight');
  }

  private directory(runId: string): string {
    assertSafeId(runId);
    return safeChild(this.root(), runId);
  }

  async reserve(state: LiveRunState): Promise<void> {
    assertSafeId(state.runId);
    const finalDirectory = safeChild(this.artifactRoot, 'runs', state.runId);
    try {
      await readFile(safeChild(finalDirectory, '.committed'), 'utf8');
      throw new RunIdAlreadyExistsError();
    } catch (error) {
      if (!isMissing(error)) {
        throw error;
      }
    }
    try {
      await readFile(safeChild(finalDirectory, '.reserved'), 'utf8');
    } catch (error) {
      if (isMissing(error)) {
        try {
          await readdir(finalDirectory);
          throw new RunIdAlreadyExistsError();
        } catch (directoryError) {
          if (!isMissing(directoryError)) {
            throw directoryError;
          }
        }
      } else {
        throw error;
      }
    }

    const directory = this.directory(state.runId);
    await mkdir(this.root(), { recursive: true });
    try {
      await mkdir(directory);
    } catch (error) {
      if (isAlreadyExists(error)) {
        throw new RunIdAlreadyExistsError();
      }
      throw error;
    }

    try {
      const parsedState: LiveRunState = {
        runId: state.runId,
        plan: executablePlanV1Schema.parse(state.plan),
        checkpoint: liveRunCheckpointV1Schema.parse(state.checkpoint),
        resourceInventory: resourceInventoryV1Schema.parse(state.resourceInventory),
        observations: stepObservationV1Schema.array().parse(state.observations),
      };
      await writeFile(
        safeChild(directory, 'plan.json'),
        serializeForPersistence(parsedState.plan),
        {
          encoding: 'utf8',
          flag: 'wx',
        },
      );
      await writeFile(
        safeChild(directory, 'checkpoint.json'),
        serializeForPersistence(parsedState.checkpoint),
        { encoding: 'utf8', flag: 'wx' },
      );
      await writeFile(
        safeChild(directory, 'inventory.json'),
        serializeForPersistence(parsedState.resourceInventory),
        { encoding: 'utf8', flag: 'wx' },
      );
      await writeFile(
        safeChild(directory, 'observations.json'),
        serializeForPersistence(parsedState.observations),
        { encoding: 'utf8', flag: 'wx' },
      );
    } catch (error) {
      await rm(directory, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  }

  private async writeDocument(
    directory: string,
    document: LiveStateDocument,
    bytes: string,
    state: LiveRunState,
  ): Promise<void> {
    liveStateSequence += 1;
    const temporary = safeChild(directory, `.tmp-${document}-${process.pid}-${liveStateSequence}`);
    await writeFile(temporary, bytes, { encoding: 'utf8' });
    await rename(temporary, safeChild(directory, document));
    await this.hooks.afterWrite?.(document, state);
  }

  async save(state: LiveRunState): Promise<void> {
    assertSafeId(state.runId);
    const directory = this.directory(state.runId);
    await mkdir(directory, { recursive: true });
    const parsedState: LiveRunState = {
      runId: state.runId,
      plan: executablePlanV1Schema.parse(state.plan),
      checkpoint: liveRunCheckpointV1Schema.parse(state.checkpoint),
      resourceInventory: resourceInventoryV1Schema.parse(state.resourceInventory),
      observations: stepObservationV1Schema.array().parse(state.observations),
    };
    await this.writeDocument(
      directory,
      'plan.json',
      serializeForPersistence(parsedState.plan),
      parsedState,
    );
    await this.writeDocument(
      directory,
      'checkpoint.json',
      serializeForPersistence(parsedState.checkpoint),
      parsedState,
    );
    await this.writeDocument(
      directory,
      'inventory.json',
      serializeForPersistence(parsedState.resourceInventory),
      parsedState,
    );
    await this.writeDocument(
      directory,
      'observations.json',
      serializeForPersistence(parsedState.observations),
      parsedState,
    );
  }

  async get(runId: string): Promise<LiveRunState | undefined> {
    const directory = this.directory(runId);
    try {
      const [planBytes, checkpointBytes, inventoryBytes, observationsBytes] = await Promise.all([
        readFile(safeChild(directory, 'plan.json'), 'utf8'),
        readFile(safeChild(directory, 'checkpoint.json'), 'utf8'),
        readFile(safeChild(directory, 'inventory.json'), 'utf8'),
        readFile(safeChild(directory, 'observations.json'), 'utf8'),
      ]);
      return {
        runId,
        plan: executablePlanV1Schema.parse(JSON.parse(planBytes)),
        checkpoint: liveRunCheckpointV1Schema.parse(JSON.parse(checkpointBytes)),
        resourceInventory: resourceInventoryV1Schema.parse(JSON.parse(inventoryBytes)),
        observations: stepObservationV1Schema.array().parse(JSON.parse(observationsBytes)),
      };
    } catch (error) {
      if (isMissing(error)) {
        return undefined;
      }
      throw new StorageCorruptionError('Live run state', safeChild(directory, 'checkpoint.json'));
    }
  }

  async listActive(): Promise<LiveRunState[]> {
    let entries;
    try {
      entries = await readdir(this.root(), { withFileTypes: true });
    } catch (error) {
      if (isMissing(error)) {
        return [];
      }
      throw error;
    }
    const states: LiveRunState[] = [];
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.isDirectory() || !SAFE_ID_PATTERN.test(entry.name)) {
        continue;
      }
      const state = await this.get(entry.name);
      if (state && state.checkpoint.status !== 'COMPLETED') {
        states.push(state);
      }
    }
    return states;
  }

  async complete(runId: string): Promise<void> {
    const state = await this.get(runId);
    if (!state) {
      return;
    }
    await this.save({
      ...state,
      checkpoint: liveRunCheckpointV1Schema.parse({
        ...state.checkpoint,
        status: 'COMPLETED',
        updatedAt: new Date().toISOString(),
      }),
    });
  }
}

export class FilesystemNilesIncidentFixtureRepository {
  constructor(private readonly root: string) {}

  async list(): Promise<NilesIncidentFixtureV1[]> {
    const fixtures: NilesIncidentFixtureV1[] = [];
    for (const file of await yamlFiles(this.root, true)) {
      try {
        fixtures.push(parseNilesIncidentFixture(await readYaml(file)));
      } catch {
        throw new StorageCorruptionError('NILES incident fixture', file);
      }
    }
    return fixtures.sort((left, right) => left.id.localeCompare(right.id));
  }

  async getForEnvironment(environmentId: string): Promise<NilesIncidentFixtureV1 | undefined> {
    assertSafeId(environmentId);
    return (await this.list()).find((fixture) => fixture.environmentId === environmentId);
  }
}

export const storageSchemas = {
  actorProfile: actorProfileV1Schema,
  environmentActorMap: environmentActorMapV1Schema,
  environment: environmentDefinitionV1Schema,
  nilesIncidentFixture: nilesIncidentFixtureV1Schema,
  scenario: businessBlueprintV1Schema,
};
