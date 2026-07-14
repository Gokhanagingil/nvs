import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  SAFE_ID_PATTERN,
  businessBlueprintV1Schema,
  environmentDefinitionV1Schema,
  evidenceManifestV1Schema,
  executablePlanV1Schema,
  parseBusinessBlueprint,
  parseEnvironmentDefinition,
  runRecordV1Schema,
  type BusinessBlueprintV1,
  type EnvironmentDefinitionV1,
  type EvidenceManifestV1,
  type ExecutablePlanV1,
  type RunRecordV1,
} from '@nvs/contracts';
import type {
  EnvironmentRepository,
  EvidenceRepository,
  RunRepository,
  ScenarioRepository,
} from '@nvs/core';
import { sanitizeForPersistence, stableJson } from '@nvs/domain';
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

let temporarySequence = 0;
async function atomicJsonWrite(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  temporarySequence += 1;
  const temporary = `${file}.tmp-${process.pid}-${temporarySequence}`;
  await writeFile(temporary, stableJson(sanitizeForPersistence(value)), {
    encoding: 'utf8',
    flag: 'wx',
  });
  await rename(temporary, file);
}

async function readJson<T>(
  file: string,
  kind: string,
  parser: { parse(value: unknown): T },
): Promise<T | undefined> {
  try {
    return parser.parse(JSON.parse(await readFile(file, 'utf8')));
  } catch (error) {
    if (isMissing(error)) {
      return undefined;
    }
    throw new StorageCorruptionError(kind, file);
  }
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

export class FilesystemRunRepository implements RunRepository {
  constructor(private readonly artifactRoot: string) {}

  async save(run: RunRecordV1, plan: ExecutablePlanV1): Promise<void> {
    assertSafeId(run.runId);
    const validRun = runRecordV1Schema.parse(run);
    const validPlan = executablePlanV1Schema.parse(plan);
    const directory = safeChild(this.artifactRoot, 'runs', run.runId);
    await atomicJsonWrite(safeChild(directory, 'plan.json'), validPlan);
    await atomicJsonWrite(safeChild(directory, 'run.json'), validRun);
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
      const run = await this.get(entry.name);
      if (run) {
        runs.push(run);
      }
    }
    return runs.sort((left, right) =>
      right.timestamps.createdAt.localeCompare(left.timestamps.createdAt),
    );
  }

  async get(id: string): Promise<RunRecordV1 | undefined> {
    assertSafeId(id);
    return readJson(safeChild(this.artifactRoot, 'runs', id, 'run.json'), 'Run', runRecordV1Schema);
  }

  async getPlan(id: string): Promise<ExecutablePlanV1 | undefined> {
    assertSafeId(id);
    return readJson(
      safeChild(this.artifactRoot, 'runs', id, 'plan.json'),
      'Plan',
      executablePlanV1Schema,
    );
  }
}

export class FilesystemEvidenceRepository implements EvidenceRepository {
  constructor(private readonly artifactRoot: string) {}

  async save(manifest: EvidenceManifestV1): Promise<void> {
    assertSafeId(manifest.runId);
    const validManifest = evidenceManifestV1Schema.parse(manifest);
    await atomicJsonWrite(
      safeChild(this.artifactRoot, 'runs', manifest.runId, 'evidence.json'),
      validManifest,
    );
  }

  async get(runId: string): Promise<EvidenceManifestV1 | undefined> {
    assertSafeId(runId);
    return readJson(
      safeChild(this.artifactRoot, 'runs', runId, 'evidence.json'),
      'Evidence',
      evidenceManifestV1Schema,
    );
  }
}

export const storageSchemas = {
  environment: environmentDefinitionV1Schema,
  scenario: businessBlueprintV1Schema,
};
