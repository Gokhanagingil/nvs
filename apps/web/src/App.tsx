import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import {
  Link,
  NavLink,
  Navigate,
  Route,
  Routes,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import { ActorReadinessPanel } from './ActorReadinessPanel.js';
import { ApiError, apiRequest, errorMessage } from './api.js';
import type {
  BuildInformation,
  CoverageResult,
  EnvironmentDefinition,
  ExecutionReadiness,
  EvidenceManifest,
  ExecutablePlan,
  ProbeResult,
  ResourceInventory,
  RunProgress,
  RunRecord,
  Scenario,
} from './types.js';

type Loadable<T> =
  | { status: 'loading' }
  | { status: 'empty' }
  | { status: 'error'; message: string; code?: string }
  | { status: 'ready'; data: T };

const LIVE_PENDING_RUN_STORAGE_KEY = 'nvs.pendingLiveRunId';

function rememberPendingLiveRun(runId: string) {
  window.sessionStorage.setItem(LIVE_PENDING_RUN_STORAGE_KEY, runId);
}

function forgetPendingLiveRun() {
  window.sessionStorage.removeItem(LIVE_PENDING_RUN_STORAGE_KEY);
}

function readPendingLiveRun() {
  return window.sessionStorage.getItem(LIVE_PENDING_RUN_STORAGE_KEY);
}

const navItems = [
  { to: '/environments', label: 'Environments' },
  { to: '/scenarios', label: 'Scenario Library' },
  { to: '/runs', label: 'Run Center' },
  { to: '/evidence', label: 'Evidence Explorer' },
  { to: '/coverage', label: 'Coverage' },
];

function StatusBadge({ value }: { value: string }) {
  return (
    <span className={`status status-${value.toLowerCase().replaceAll('_', '-')}`}>{value}</span>
  );
}

function ErrorPanel({ title = 'Unable to load', message }: { title?: string; message: string }) {
  return (
    <section className="state-panel state-error" role="alert">
      <strong>{title}</strong>
      <p>{message}</p>
    </section>
  );
}

function LoadingPanel({ label }: { label: string }) {
  return (
    <section className="state-panel" aria-live="polite" aria-busy="true">
      <span className="spinner" aria-hidden="true" />
      <p>{label}</p>
    </section>
  );
}

function EmptyPanel({ message }: { message: string }) {
  return (
    <section className="state-panel">
      <strong>Nothing here yet</strong>
      <p>{message}</p>
    </section>
  );
}

function PageHeader({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <header className="page-header">
      <p className="eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      <p>{description}</p>
    </header>
  );
}

function Shell() {
  const [build, setBuild] = useState<BuildInformation>();

  useEffect(() => {
    void apiRequest<BuildInformation>('/api/version')
      .then(setBuild)
      .catch(() => setBuild(undefined));
  }, []);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <header className="masthead">
        <Link className="brand" to="/scenarios" aria-label="NVS console home">
          <span className="brand-mark" aria-hidden="true">
            NV
          </span>
          <span>
            <strong>NVS</strong>
            <small>Validation Console</small>
          </span>
        </Link>
        <div className="masthead-meta">
          <div className="scope-chip">
            <span aria-hidden="true" />
            Local control plane
          </div>
          <div
            className="build-fingerprint"
            title={build ? `Build SHA ${build.buildSha}` : 'Build fingerprint unavailable'}
          >
            <small>Running build</small>
            <strong>
              {build
                ? `${build.releaseVersion} · ${
                    build.buildSha === 'unknown' ? 'unknown SHA' : build.buildSha.slice(0, 12)
                  }`
                : 'Unavailable'}
            </strong>
          </div>
        </div>
      </header>
      <nav className="primary-nav" aria-label="Primary navigation">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) => (isActive ? 'active' : undefined)}
          >
            {item.label}
          </NavLink>
        ))}
      </nav>
      <main id="main-content">
        <Routes>
          <Route path="/" element={<Navigate replace to="/scenarios" />} />
          <Route path="/environments" element={<EnvironmentsPage />} />
          <Route path="/scenarios" element={<ScenarioLibraryPage />} />
          <Route path="/scenarios/:scenarioId" element={<ScenarioLibraryPage />} />
          <Route path="/runs" element={<RunCenterPage />} />
          <Route path="/evidence" element={<EvidenceExplorerPage />} />
          <Route path="/coverage" element={<CoveragePage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </main>
      <footer>
        Live NILES mutation remains disabled unless the server switch, fixture, readiness, and
        explicit confirmation gates all pass.
      </footer>
    </div>
  );
}

type ProbeState =
  | { status: 'loading' }
  | { status: 'error'; message: string; code?: string }
  | { status: 'ready'; result: ProbeResult };

function EnvironmentsPage() {
  const [environments, setEnvironments] = useState<Loadable<EnvironmentDefinition[]>>({
    status: 'loading',
  });
  const [probes, setProbes] = useState<Record<string, ProbeState | undefined>>({});

  useEffect(() => {
    void apiRequest<{ items: EnvironmentDefinition[] }>('/api/environments')
      .then(({ items }) =>
        setEnvironments(
          items.length === 0 ? { status: 'empty' } : { status: 'ready', data: items },
        ),
      )
      .catch((error: unknown) =>
        setEnvironments({ status: 'error', message: errorMessage(error) }),
      );
  }, []);

  const probe = async (environmentId: string) => {
    setProbes((current) => ({ ...current, [environmentId]: { status: 'loading' } }));
    try {
      const result = await apiRequest<ProbeResult>(
        `/api/environments/${encodeURIComponent(environmentId)}/probe`,
        { method: 'POST', body: '{}' },
      );
      setProbes((current) => ({ ...current, [environmentId]: { status: 'ready', result } }));
    } catch (error) {
      setProbes((current) => ({
        ...current,
        [environmentId]: {
          status: 'error',
          message: errorMessage(error),
          ...(error instanceof ApiError ? { code: error.code } : {}),
        },
      }));
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Target inventory"
        title="Environments"
        description="Review non-sensitive definitions. A read-only target probe is sent only when you explicitly request it."
      />
      {environments.status === 'loading' && (
        <LoadingPanel label="Loading environment definitions…" />
      )}
      {environments.status === 'empty' && (
        <EmptyPanel message="Add a versioned environment definition to make it available here." />
      )}
      {environments.status === 'error' && <ErrorPanel message={environments.message} />}
      {environments.status === 'ready' && (
        <div className="card-grid">
          {environments.data.map((environment) => {
            const probeState = probes[environment.id];
            return (
              <article className="card environment-card" key={environment.id}>
                <header className="card-heading">
                  <div>
                    <p className="eyebrow">{environment.id}</p>
                    <h2>{environment.displayName}</h2>
                  </div>
                  <div className="status-pair">
                    <StatusBadge value={environment.kind} />
                    <StatusBadge value={environment.enabled ? 'enabled' : 'disabled'} />
                  </div>
                </header>
                <dl className="definition-list">
                  <div>
                    <dt>Health</dt>
                    <dd>{environment.capabilities.health ? 'Declared' : 'Unavailable'}</dd>
                  </div>
                  <div>
                    <dt>Readiness</dt>
                    <dd>{environment.capabilities.readiness ? 'Declared' : 'Not declared'}</dd>
                  </div>
                  <div>
                    <dt>OpenAPI</dt>
                    <dd>{environment.capabilities.openApi ? 'Declared' : 'Not declared'}</dd>
                  </div>
                  <div>
                    <dt>Build fingerprint</dt>
                    <dd>{environment.capabilities.version ? 'Declared' : 'Not declared'}</dd>
                  </div>
                </dl>
                <button
                  className="button button-secondary"
                  type="button"
                  disabled={probeState?.status === 'loading'}
                  onClick={() => void probe(environment.id)}
                >
                  {probeState?.status === 'loading' ? 'Probing read-only…' : 'Run read-only probe'}
                </button>
                {!probeState && (
                  <p className="muted probe-placeholder">
                    Not probed — no target request has been sent.
                  </p>
                )}
                {probeState?.status === 'error' && (
                  <ErrorPanel
                    title={`Probe error${probeState.code ? ` · ${probeState.code}` : ''}`}
                    message={probeState.message}
                  />
                )}
                {probeState?.status === 'ready' && (
                  <section
                    className={`probe-result ${probeState.result.verdict === 'BLOCKED' ? 'blocked' : ''}`}
                    aria-live="polite"
                  >
                    <header>
                      <h3>Probe result</h3>
                      <StatusBadge value={probeState.result.verdict} />
                    </header>
                    <dl className="definition-list">
                      <div>
                        <dt>Health</dt>
                        <dd>
                          {probeState.result.health.available ? 'Available' : 'Unavailable'}
                          {probeState.result.health.status
                            ? ` · HTTP ${probeState.result.health.status}`
                            : ''}
                        </dd>
                      </div>
                      <div>
                        <dt>Readiness</dt>
                        <dd>
                          {probeState.result.readiness.available ? 'Available' : 'Unavailable'}
                          {probeState.result.readiness.status
                            ? ` · HTTP ${probeState.result.readiness.status}`
                            : ''}
                          {probeState.result.readiness.state
                            ? ` · ${probeState.result.readiness.state}`
                            : ''}
                        </dd>
                      </div>
                      <div>
                        <dt>OpenAPI</dt>
                        <dd>
                          {probeState.result.openApi.available ? 'Available' : 'Unavailable'}
                          {probeState.result.openApi.status
                            ? ` · HTTP ${probeState.result.openApi.status}`
                            : ''}
                        </dd>
                      </div>
                      <div>
                        <dt>Build fingerprint</dt>
                        <dd>
                          {probeState.result.version.available
                            ? [
                                probeState.result.version.commit,
                                probeState.result.version.buildTimestamp,
                              ]
                                .filter(Boolean)
                                .join(' · ')
                            : 'Unavailable'}
                        </dd>
                      </div>
                    </dl>
                    {probeState.result.error && (
                      <div className="typed-error" role="alert">
                        <strong>
                          {probeState.result.error.category} · {probeState.result.error.code}
                        </strong>
                        <p>{probeState.result.error.message}</p>
                      </div>
                    )}
                  </section>
                )}
                <ActorReadinessPanel environment={environment} />
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}

function ScenarioLibraryPage() {
  const { scenarioId } = useParams();
  const navigate = useNavigate();
  const [scenarios, setScenarios] = useState<Loadable<Scenario[]>>({ status: 'loading' });
  const [detail, setDetail] = useState<Loadable<Scenario>>({ status: 'loading' });

  useEffect(() => {
    void apiRequest<{ items: Scenario[] }>('/api/scenarios')
      .then(({ items }) =>
        setScenarios(items.length === 0 ? { status: 'empty' } : { status: 'ready', data: items }),
      )
      .catch((error: unknown) => setScenarios({ status: 'error', message: errorMessage(error) }));
  }, []);

  const selectedId =
    scenarioId ?? (scenarios.status === 'ready' ? scenarios.data[0]?.id : undefined);

  useEffect(() => {
    if (!selectedId) return;
    setDetail({ status: 'loading' });
    void apiRequest<Scenario>(`/api/scenarios/${encodeURIComponent(selectedId)}`)
      .then((scenario) => setDetail({ status: 'ready', data: scenario }))
      .catch((error: unknown) => setDetail({ status: 'error', message: errorMessage(error) }));
  }, [selectedId]);

  return (
    <>
      <PageHeader
        eyebrow="Approved business blueprints"
        title="Scenario Library"
        description="Business intent stays primary. Compiled action primitives are available only as supporting technical detail."
      />
      {scenarios.status === 'loading' && <LoadingPanel label="Loading scenario library…" />}
      {scenarios.status === 'empty' && (
        <EmptyPanel message="No approved or generated scenario blueprints were found." />
      )}
      {scenarios.status === 'error' && <ErrorPanel message={scenarios.message} />}
      {scenarios.status === 'ready' && (
        <div className="library-layout">
          <aside className="scenario-list" aria-label="Scenarios">
            <h2>Blueprints</h2>
            {scenarios.data.map((scenario) => (
              <button
                type="button"
                className={selectedId === scenario.id ? 'selected' : undefined}
                key={scenario.id}
                aria-pressed={selectedId === scenario.id}
                onClick={() => void navigate(`/scenarios/${scenario.id}`)}
              >
                <span>{scenario.title}</span>
                <small>
                  {scenario.domain} · v{scenario.version}
                </small>
              </button>
            ))}
          </aside>
          <section className="scenario-detail" aria-live="polite">
            {detail.status === 'loading' && <LoadingPanel label="Loading scenario detail…" />}
            {detail.status === 'empty' && <EmptyPanel message="No scenario detail is available." />}
            {detail.status === 'error' && <ErrorPanel message={detail.message} />}
            {detail.status === 'ready' && <ScenarioDetail scenario={detail.data} />}
          </section>
        </div>
      )}
    </>
  );
}

function ScenarioDetail({ scenario }: { scenario: Scenario }) {
  const actorNames = new Map(scenario.actors.map((actor) => [actor.id, actor.name]));
  return (
    <>
      <article className="narrative-hero">
        <div className="status-pair">
          <StatusBadge value={scenario.reviewState} />
          <span className="schema-label">{scenario.schemaVersion}</span>
        </div>
        <h2>{scenario.title}</h2>
        <p className="narrative">{scenario.narrative}</p>
        <div className="objective">
          <strong>Objective</strong>
          <p>{scenario.objective}</p>
        </div>
        <ul className="tag-list" aria-label="Risk tags">
          {scenario.riskTags.map((risk) => (
            <li key={risk}>{risk}</li>
          ))}
        </ul>
      </article>

      <section className="detail-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Business sequence</p>
            <h2>Human-readable journey</h2>
          </div>
          <span>{scenario.steps.length} steps</span>
        </div>
        <ol className="business-steps">
          {scenario.steps.map((step) => (
            <li key={step.id}>
              <article>
                <p className="step-actor">{actorNames.get(step.actor) ?? step.actor}</p>
                <h3>{step.title}</h3>
                <p>{step.narrative}</p>
                <div className="expectation-list">
                  {step.expectations.map((expectation) => (
                    <p key={`${step.id}-${expectation.kind}-${expectation.statement}`}>
                      <StatusBadge value={expectation.kind} />
                      {expectation.statement}
                    </p>
                  ))}
                </div>
                <details>
                  <summary>Secondary technical detail</summary>
                  <p>
                    Primitive: <code>{step.action}</code>
                  </p>
                  <p>Source step: {step.id}</p>
                </details>
              </article>
            </li>
          ))}
        </ol>
      </section>

      <div className="two-column">
        <section className="detail-section">
          <p className="eyebrow">Personas</p>
          <h2>Actors</h2>
          <div className="stack-list">
            {scenario.actors.map((actor) => (
              <article key={actor.id}>
                <h3>{actor.name}</h3>
                <p>{actor.persona}</p>
              </article>
            ))}
          </div>
        </section>
        <section className="detail-section">
          <p className="eyebrow">Risk expansion</p>
          <h2>Variations</h2>
          <div className="stack-list">
            {scenario.variationDimensions.flatMap((dimension) =>
              dimension.values.map((value) => (
                <article key={`${dimension.id}-${value.id}`}>
                  <h3>{value.id.replaceAll('-', ' ')}</h3>
                  <p>{value.description}</p>
                  {value.overrides.expectedOutcome && (
                    <StatusBadge value={value.overrides.expectedOutcome} />
                  )}
                </article>
              )),
            )}
          </div>
        </section>
      </div>

      <section className="detail-section">
        <p className="eyebrow">Required observations</p>
        <h2>Evidence requirements</h2>
        <ul className="check-list">
          {scenario.evidenceRequirements.map((requirement) => (
            <li key={requirement}>{requirement}</li>
          ))}
        </ul>
      </section>
    </>
  );
}

interface RunFormData {
  environments: EnvironmentDefinition[];
  scenarios: Scenario[];
}

interface LaunchResult {
  run: RunRecord;
  plan: ExecutablePlan;
  scenario: Scenario;
  progress?: RunProgress;
  inventory?: ResourceInventory;
}

interface LiveRunAccepted {
  schemaVersion: 'nvs.live-run-accepted/v1';
  runId: string;
  status: 'ACCEPTED';
}

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });

async function pollLiveRunProgress(
  runId: string,
  onProgress: (progress: RunProgress, inventory?: ResourceInventory) => void,
): Promise<RunProgress> {
  for (let attempt = 0; attempt < 180; attempt += 1) {
    const progress = await apiRequest<RunProgress>(
      `/api/runs/${encodeURIComponent(runId)}/progress`,
    );
    const inventory = await apiRequest<ResourceInventory>(
      `/api/runs/${encodeURIComponent(runId)}/inventory`,
    ).catch(() => undefined);
    onProgress(progress, inventory);
    if (progress.status === 'COMPLETED' || progress.status === 'RECOVERY_REQUIRED') {
      return progress;
    }
    await wait(1000);
  }
  throw new Error('Live API run did not complete before the progress polling deadline.');
}

function RunCenterPage() {
  const [data, setData] = useState<Loadable<RunFormData>>({ status: 'loading' });
  const [runType, setRunType] = useState<'COMPILE_ONLY' | 'LIVE_API'>('COMPILE_ONLY');
  const [environmentId, setEnvironmentId] = useState('');
  const [scenarioId, setScenarioId] = useState('');
  const [variationValues, setVariationValues] = useState<Record<string, string>>({});
  const [confirmLive, setConfirmLive] = useState(false);
  const [readiness, setReadiness] = useState<Loadable<ExecutionReadiness> | undefined>();
  const [confirmedReadiness, setConfirmedReadiness] = useState<
    Loadable<ExecutionReadiness> | undefined
  >();
  const [launch, setLaunch] = useState<Loadable<LaunchResult> | undefined>();
  const [pendingLive, setPendingLive] = useState<
    { runId: string; progress?: RunProgress; inventory?: ResourceInventory } | undefined
  >();
  const [activeLiveRuns, setActiveLiveRuns] = useState<RunProgress[]>([]);

  useEffect(() => {
    void Promise.all([
      apiRequest<{ items: EnvironmentDefinition[] }>('/api/environments'),
      apiRequest<{ items: Scenario[] }>('/api/scenarios'),
    ])
      .then(([environmentResponse, scenarioResponse]) => {
        if (environmentResponse.items.length === 0 || scenarioResponse.items.length === 0) {
          setData({ status: 'empty' });
          return;
        }
        setData({
          status: 'ready',
          data: {
            environments: environmentResponse.items,
            scenarios: scenarioResponse.items,
          },
        });
        setEnvironmentId(
          environmentResponse.items.find((environment) => environment.enabled)?.id ??
            environmentResponse.items[0]!.id,
        );
        setScenarioId(scenarioResponse.items[0]!.id);
      })
      .catch((error: unknown) => setData({ status: 'error', message: errorMessage(error) }));
  }, []);

  const selectedScenario =
    data.status === 'ready'
      ? data.data.scenarios.find((scenario) => scenario.id === scenarioId)
      : undefined;

  useEffect(() => {
    if (!selectedScenario) return;
    setVariationValues(
      Object.fromEntries(
        selectedScenario.variationDimensions
          .filter((dimension) => dimension.values[0])
          .map((dimension) => [dimension.id, dimension.values[0]!.id]),
      ),
    );
  }, [selectedScenario]);

  useEffect(() => {
    setConfirmedReadiness(undefined);
    if (runType !== 'LIVE_API' || !environmentId || !scenarioId) {
      setReadiness(undefined);
      return;
    }
    const params = new URLSearchParams({ scenarioId });
    if (variationValues['journey']) {
      params.set('journey', variationValues['journey']);
    }
    setReadiness({ status: 'loading' });
    void apiRequest<ExecutionReadiness>(
      `/api/environments/${encodeURIComponent(environmentId)}/execution-readiness?${params.toString()}`,
    )
      .then((result) => setReadiness({ status: 'ready', data: result }))
      .catch((error: unknown) =>
        setReadiness({
          status: 'error',
          message: errorMessage(error),
          ...(error instanceof ApiError ? { code: error.code } : {}),
        }),
      );
  }, [environmentId, scenarioId, runType, variationValues]);

  useEffect(() => {
    const rememberedRunId = readPendingLiveRun();
    if (!rememberedRunId) return;
    let cancelled = false;
    setPendingLive({ runId: rememberedRunId });
    setLaunch({ status: 'loading' });
    void pollLiveRunProgress(rememberedRunId, (nextProgress, inventory) => {
      if (cancelled) return;
      setPendingLive({
        runId: rememberedRunId,
        progress: nextProgress,
        ...(inventory ? { inventory } : {}),
      });
    })
      .then(async (progress) => {
        if (cancelled) return;
        if (progress.status === 'RECOVERY_REQUIRED') {
          setLaunch(undefined);
          return;
        }
        const [run, plan, inventory] = await Promise.all([
          apiRequest<RunRecord>(`/api/runs/${encodeURIComponent(rememberedRunId)}`),
          apiRequest<ExecutablePlan>(`/api/runs/${encodeURIComponent(rememberedRunId)}/plan`),
          apiRequest<ResourceInventory>(
            `/api/runs/${encodeURIComponent(rememberedRunId)}/inventory`,
          ),
        ]);
        if (cancelled) return;
        const scenario = await apiRequest<Scenario>(
          `/api/scenarios/${encodeURIComponent(run.scenario.id)}`,
        );
        if (cancelled) return;
        forgetPendingLiveRun();
        setPendingLive(undefined);
        setLaunch({ status: 'ready', data: { run, plan, scenario, progress, inventory } });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLaunch({
          status: 'error',
          message: errorMessage(error),
          ...(error instanceof ApiError ? { code: error.code } : {}),
        });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    void apiRequest<{ items: RunProgress[] }>('/api/runs/live-active')
      .then(({ items }) => setActiveLiveRuns(items))
      .catch(() => setActiveLiveRuns([]));
  }, [pendingLive?.runId, launch?.status]);

  const confirmExecutionReadiness = async () => {
    if (!environmentId || !scenarioId) return;
    setConfirmedReadiness({ status: 'loading' });
    try {
      const result = await apiRequest<ExecutionReadiness>(
        `/api/environments/${encodeURIComponent(environmentId)}/execution-readiness/confirm`,
        {
          method: 'POST',
          body: JSON.stringify({ scenarioId, variationValues }),
        },
      );
      setConfirmedReadiness({ status: 'ready', data: result });
    } catch (error) {
      setConfirmedReadiness({
        status: 'error',
        message: errorMessage(error),
        ...(error instanceof ApiError ? { code: error.code } : {}),
      });
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!environmentId || !scenarioId) return;
    setLaunch({ status: 'loading' });
    setPendingLive(undefined);
    try {
      if (runType === 'LIVE_API') {
        const accepted = await apiRequest<LiveRunAccepted>('/api/runs', {
          method: 'POST',
          body: JSON.stringify({
            runType,
            environmentId,
            scenarioId,
            variationValues,
            confirmRealMutation: true,
          }),
        });
        rememberPendingLiveRun(accepted.runId);
        setPendingLive({ runId: accepted.runId });
        const progress = await pollLiveRunProgress(accepted.runId, (nextProgress, inventory) => {
          setPendingLive({
            runId: accepted.runId,
            progress: nextProgress,
            ...(inventory ? { inventory } : {}),
          });
        });
        if (progress.status === 'RECOVERY_REQUIRED') {
          setLaunch(undefined);
          return;
        }
        const [run, plan, scenario, inventory] = await Promise.all([
          apiRequest<RunRecord>(`/api/runs/${encodeURIComponent(accepted.runId)}`),
          apiRequest<ExecutablePlan>(`/api/runs/${encodeURIComponent(accepted.runId)}/plan`),
          apiRequest<Scenario>(`/api/scenarios/${encodeURIComponent(scenarioId)}`),
          apiRequest<ResourceInventory>(
            `/api/runs/${encodeURIComponent(accepted.runId)}/inventory`,
          ),
        ]);
        forgetPendingLiveRun();
        setPendingLive(undefined);
        setLaunch({ status: 'ready', data: { run, plan, scenario, progress, inventory } });
        return;
      }

      const run = await apiRequest<RunRecord>('/api/runs', {
        method: 'POST',
        body: JSON.stringify({
          runType,
          environmentId,
          scenarioId,
          variationValues,
        }),
      });
      const [plan, scenario, progress, inventory] = await Promise.all([
        apiRequest<ExecutablePlan>(`/api/runs/${encodeURIComponent(run.runId)}/plan`),
        apiRequest<Scenario>(`/api/scenarios/${encodeURIComponent(run.scenario.id)}`),
        run.runType === 'LIVE_API'
          ? apiRequest<RunProgress>(`/api/runs/${encodeURIComponent(run.runId)}/progress`)
          : Promise.resolve(undefined),
        run.runType === 'LIVE_API'
          ? apiRequest<ResourceInventory>(`/api/runs/${encodeURIComponent(run.runId)}/inventory`)
          : Promise.resolve(undefined),
      ]);
      setLaunch({
        status: 'ready',
        data: {
          run,
          plan,
          scenario,
          ...(progress ? { progress } : {}),
          ...(inventory ? { inventory } : {}),
        },
      });
    } catch (error) {
      setLaunch({
        status: 'error',
        message: errorMessage(error),
        ...(error instanceof ApiError ? { code: error.code } : {}),
      });
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Run orchestration"
        title="Run Center"
        description="Compile a selected business variation or launch the guarded live Incident API slice when every live gate is satisfied."
      />
      {data.status === 'loading' && <LoadingPanel label="Loading run configuration…" />}
      {data.status === 'empty' && (
        <EmptyPanel message="At least one environment and one scenario are required to create a run." />
      )}
      {data.status === 'error' && <ErrorPanel message={data.message} />}
      {data.status === 'ready' && (
        <div className="run-layout">
          <form className="card run-form" onSubmit={(event) => void submit(event)}>
            <h2>{runType === 'LIVE_API' ? 'Launch live API run' : 'Compile a scenario'}</h2>
            <p className="muted">
              {runType === 'LIVE_API'
                ? 'Live API runs are limited to the frozen M1-02B journey after readiness and confirmation gates pass.'
                : 'No environment probe or NILES mutation is part of this action.'}
            </p>
            <label htmlFor="run-type">Run type</label>
            <select
              id="run-type"
              value={runType}
              onChange={(event) => setRunType(event.target.value as 'COMPILE_ONLY' | 'LIVE_API')}
            >
              <option value="COMPILE_ONLY">Compile only</option>
              <option value="LIVE_API">Live Incident API</option>
            </select>
            <label htmlFor="run-environment">Environment</label>
            <select
              id="run-environment"
              value={environmentId}
              onChange={(event) => setEnvironmentId(event.target.value)}
            >
              {data.data.environments.map((environment) => (
                <option value={environment.id} key={environment.id}>
                  {environment.displayName} · {environment.kind}
                  {!environment.enabled ? ' · disabled' : ''}
                </option>
              ))}
            </select>
            <label htmlFor="run-scenario">Scenario</label>
            <select
              id="run-scenario"
              value={scenarioId}
              onChange={(event) => setScenarioId(event.target.value)}
            >
              {data.data.scenarios.map((scenario) => (
                <option value={scenario.id} key={scenario.id}>
                  {scenario.title}
                </option>
              ))}
            </select>
            {selectedScenario?.variationDimensions.map((dimension) => (
              <div className="form-field" key={dimension.id}>
                <label htmlFor={`variation-${dimension.id}`}>{dimension.description}</label>
                <select
                  id={`variation-${dimension.id}`}
                  value={variationValues[dimension.id] ?? ''}
                  onChange={(event) =>
                    setVariationValues((current) => ({
                      ...current,
                      [dimension.id]: event.target.value,
                    }))
                  }
                >
                  {dimension.values.map((value) => (
                    <option value={value.id} key={value.id}>
                      {value.id.replaceAll('-', ' ')} — {value.description}
                    </option>
                  ))}
                </select>
              </div>
            ))}
            {runType === 'LIVE_API' && (
              <>
                <LiveReadinessPanel
                  readiness={readiness}
                  confirmedReadiness={confirmedReadiness}
                  onConfirm={() => void confirmExecutionReadiness()}
                />
                <label className="checkbox-field">
                  <input
                    type="checkbox"
                    checked={confirmLive}
                    onChange={(event) => setConfirmLive(event.target.checked)}
                  />
                  Confirm this may create or change a synthetic non-production NILES Incident.
                </label>
              </>
            )}
            <button
              className="button button-primary"
              type="submit"
              disabled={
                launch?.status === 'loading' ||
                (runType === 'LIVE_API' &&
                  (!confirmLive ||
                    confirmedReadiness?.status !== 'ready' ||
                    confirmedReadiness.data.verdict !== 'PASS' ||
                    !confirmedReadiness.data.mutationEligible))
              }
            >
              {launch?.status === 'loading'
                ? runType === 'LIVE_API'
                  ? 'Live run accepted; polling progress...'
                  : 'Compiling business plan...'
                : runType === 'LIVE_API'
                  ? 'Start confirmed live run'
                  : 'Launch compile-only run'}
            </button>
          </form>

          <section className="run-result" aria-live="polite">
            <ActiveLiveRunsPanel runs={activeLiveRuns} />
            {pendingLive && <LivePendingPanel pending={pendingLive} />}
            {!launch && !pendingLive && (
              <section className="state-panel">
                <strong>Ready to compile</strong>
                <p>Select a variation and launch a local NVS compile-only run.</p>
              </section>
            )}
            {launch?.status === 'loading' && !pendingLive && (
              <LoadingPanel
                label={
                  runType === 'LIVE_API'
                    ? 'Live API run accepted; polling runtime progress...'
                    : 'Compiling deterministic plan...'
                }
              />
            )}
            {launch?.status === 'empty' && <EmptyPanel message="No run result was returned." />}
            {launch?.status === 'error' && (
              <ErrorPanel
                title={`Run BLOCKED or failed${launch.code ? ` · ${launch.code}` : ''}`}
                message={launch.message}
              />
            )}
            {launch?.status === 'ready' &&
              (launch.data.run.runType === 'LIVE_API' ? (
                <LiveRunResult result={launch.data} />
              ) : (
                <CompileOnlyResult result={launch.data} />
              ))}
          </section>
        </div>
      )}
    </>
  );
}

function LiveReadinessPanel({
  readiness,
  confirmedReadiness,
  onConfirm,
}: {
  readiness: Loadable<ExecutionReadiness> | undefined;
  confirmedReadiness: Loadable<ExecutionReadiness> | undefined;
  onConfirm: () => void;
}) {
  if (!readiness) return null;
  if (readiness.status === 'loading') {
    return <LoadingPanel label="Checking static live API eligibility..." />;
  }
  if (readiness.status === 'error') {
    return (
      <ErrorPanel
        title={`Static readiness unavailable${readiness.code ? ` - ${readiness.code}` : ''}`}
        message={readiness.message}
      />
    );
  }
  if (readiness.status === 'empty') {
    return null;
  }
  return (
    <section className={`live-readiness ${readiness.data.verdict.toLowerCase()}`}>
      <header>
        <div>
          <p className="eyebrow">Live API static eligibility</p>
          <h3>
            <StatusBadge value={readiness.data.verdict} />{' '}
            {readiness.data.staticEligible ? 'Static gates passed' : 'Static gates blocked'}
          </h3>
        </div>
      </header>
      <ul>
        {readiness.data.checks.map((check) => (
          <li key={check.id}>
            <StatusBadge value={check.status} />
            <span>{check.message}</span>
            {check.code && <code>{check.code}</code>}
          </li>
        ))}
      </ul>
      <button
        className="button button-secondary"
        type="button"
        disabled={readiness.data.verdict !== 'PASS' || confirmedReadiness?.status === 'loading'}
        onClick={onConfirm}
      >
        {confirmedReadiness?.status === 'loading'
          ? 'Running confirmed preflight...'
          : 'Run confirmed preflight'}
      </button>
      {confirmedReadiness?.status === 'error' && (
        <ErrorPanel
          title={`Confirmed readiness unavailable${
            confirmedReadiness.code ? ` - ${confirmedReadiness.code}` : ''
          }`}
          message={confirmedReadiness.message}
        />
      )}
      {confirmedReadiness?.status === 'ready' && (
        <div className="readiness-confirmation">
          <h3>
            <StatusBadge value={confirmedReadiness.data.verdict} />{' '}
            {confirmedReadiness.data.mutationEligible
              ? 'Confirmed mutation eligible'
              : 'Confirmed preflight blocked'}
          </h3>
          <ul>
            {confirmedReadiness.data.checks
              .filter((check) => ['actor-authentication', 'fixture-resources'].includes(check.id))
              .map((check) => (
                <li key={check.id}>
                  <StatusBadge value={check.status} />
                  <span>{check.message}</span>
                  {check.code && <code>{check.code}</code>}
                </li>
              ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function ActiveLiveRunsPanel({ runs }: { runs: RunProgress[] }) {
  if (runs.length === 0) return null;
  return (
    <section className="detail-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Durable live checkpoints</p>
          <h2>Active or recovery-required runs</h2>
        </div>
        <span>{runs.length} tracked</span>
      </div>
      <ul className="manifest-list">
        {runs.map((run) => (
          <li key={run.runId}>
            <StatusBadge value={run.status} />
            <div>
              <strong>{run.runId}</strong>
              <small>{run.observations.length} observations</small>
              <Link className="button button-secondary" to={`/evidence?runId=${run.runId}`}>
                Open inventory
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function LivePendingPanel({
  pending,
}: {
  pending: { runId: string; progress?: RunProgress; inventory?: ResourceInventory };
}) {
  const currentObservation = pending.progress?.observations.at(-1);
  const completedSteps = pending.progress?.checkpoint?.completedStepIds.length ?? 0;
  return (
    <section className="detail-section" role="status">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Live API progress</p>
          <h2>
            <StatusBadge value={pending.progress?.status ?? 'ACCEPTED'} /> Run{' '}
            <code>{pending.runId}</code>
          </h2>
        </div>
        <span>{completedSteps} completed</span>
      </div>
      <dl className="definition-list">
        <div>
          <dt>Verdict</dt>
          <dd>{pending.progress?.verdict ?? 'PENDING'}</dd>
        </div>
        <div>
          <dt>Current step</dt>
          <dd>{currentObservation?.sourceStepId ?? 'Waiting for first observation'}</dd>
        </div>
        {pending.inventory?.incident && (
          <div>
            <dt>Incident</dt>
            <dd>
              <code>{pending.inventory.incident.number ?? pending.inventory.incident.id}</code>
              {pending.inventory.incident.status ? ` - ${pending.inventory.incident.status}` : ''}
            </dd>
          </div>
        )}
      </dl>
      {pending.progress?.status === 'RECOVERY_REQUIRED' && (
        <div className="typed-error">
          <strong>Operator recovery required</strong>
          <p>
            The durable in-flight checkpoint is still present. Use the run ID and inventory above to
            inspect recovery before launching another live run.
          </p>
        </div>
      )}
    </section>
  );
}

function LiveRunResult({ result }: { result: LaunchResult }) {
  if (result.run.runType !== 'LIVE_API') return null;
  return (
    <>
      <section className="scope-warning" role="status">
        <div className="status-pair">
          <StatusBadge value={result.run.verdict} />
          <StatusBadge value={result.run.assuranceScope} />
        </div>
        <h2>Live Incident API run completed</h2>
        <p>
          Gate eligible: <strong>{result.run.gateEligible ? 'Yes' : 'No'}</strong>. Cleanup:{' '}
          <strong>{result.run.cleanup.status}</strong> via {result.run.cleanup.policy}.
        </p>
        {result.run.error && (
          <div className="typed-error">
            <strong>
              {result.run.error.category} - {result.run.error.code}
            </strong>
            <p>{result.run.error.message}</p>
          </div>
        )}
      </section>
      {result.inventory && (
        <section className="detail-section">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Resource disposition</p>
              <h2>Inventory</h2>
            </div>
            {result.inventory.incident && (
              <StatusBadge value={result.inventory.incident.disposition} />
            )}
          </div>
          <dl className="definition-list">
            {result.inventory.incident && (
              <div>
                <dt>Incident</dt>
                <dd>
                  <code>{result.inventory.incident.number ?? result.inventory.incident.id}</code>
                  {result.inventory.incident.status ? ` - ${result.inventory.incident.status}` : ''}
                </dd>
              </div>
            )}
            <div>
              <dt>Tenant</dt>
              <dd>
                <code>{result.inventory.tenantId}</code>
              </dd>
            </div>
          </dl>
        </section>
      )}
      {result.progress && (
        <section className="detail-section">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Runtime observations</p>
              <h2>Step progress</h2>
            </div>
            <span>{result.progress.observations.length} observed</span>
          </div>
          <ol className="progress-list">
            {result.progress.observations.map((observation) => (
              <li key={observation.id}>
                <span className="progress-dot" aria-hidden="true">
                  {observation.status === 'PASS' ? 'ok' : '!'}
                </span>
                <div>
                  <h3>{observation.sourceStepId.replaceAll('-', ' ')}</h3>
                  <div className="status-pair">
                    <StatusBadge value={observation.status} />
                    <code>{observation.action}</code>
                  </div>
                  {observation.error && (
                    <small>
                      {observation.error.category} - {observation.error.code}
                    </small>
                  )}
                </div>
              </li>
            ))}
          </ol>
          <Link className="button button-secondary" to={`/evidence?runId=${result.run.runId}`}>
            View evidence
          </Link>
        </section>
      )}
    </>
  );
}

function CompileOnlyResult({ result }: { result: LaunchResult }) {
  const run = result.run;
  if (run.runType !== 'COMPILE_ONLY') return null;
  const sourceSteps = new Map(result.scenario.steps.map((step) => [step.id, step]));
  return (
    <>
      <section className="scope-warning" role="status">
        <div>
          <p className="eyebrow">Compilation scope only</p>
          <h2>
            <StatusBadge value={run.verdict} /> Plan generated
          </h2>
        </div>
        <strong>Not release-gate eligible · gateEligible: false</strong>
        <p>
          This compile-only PASS is not a NILES release verdict. No NILES Incident, SLA,
          authorization, or tenant behavior was executed.
        </p>
      </section>
      <section className="detail-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Joined to blueprint source</p>
            <h2>Business-step compilation progress</h2>
          </div>
          <span>{result.plan.steps.length} compiled</span>
        </div>
        <ol className="progress-list">
          {result.plan.steps.map((planStep) => {
            const businessStep = sourceSteps.get(planStep.source.blueprintStepId);
            const resultStep = run.stepResults.find((step) => step.stepId === planStep.id);
            return (
              <li key={planStep.id}>
                <span className="progress-dot" aria-hidden="true">
                  {resultStep?.compilationStatus === 'PASS' ? '✓' : '—'}
                </span>
                <div>
                  <h3>{businessStep?.title ?? planStep.source.blueprintStepId}</h3>
                  <p>{businessStep?.narrative}</p>
                  {resultStep ? (
                    <div className="status-pair">
                      <span>
                        Compilation <StatusBadge value={resultStep.compilationStatus} />
                      </span>
                      <span>
                        NILES execution <StatusBadge value={resultStep.executionStatus} />
                      </span>
                    </div>
                  ) : (
                    <small>Compilation result unavailable</small>
                  )}
                  <small>Source {planStep.source.blueprintStepId}</small>
                </div>
              </li>
            );
          })}
        </ol>
        <Link className="button button-secondary" to={`/evidence?runId=${result.run.runId}`}>
          View evidence
        </Link>
      </section>
    </>
  );
}

interface CompletedEvidenceDetail {
  run: RunRecord;
  evidence: EvidenceManifest;
  plan: ExecutablePlan;
  scenario: Scenario;
  progress?: RunProgress;
  inventory?: ResourceInventory;
}

interface RecoveryEvidenceDetail {
  recovery: true;
  runId: string;
  plan: ExecutablePlan;
  progress: RunProgress;
  inventory: ResourceInventory;
}

type EvidenceDetail = CompletedEvidenceDetail | RecoveryEvidenceDetail;

function EvidenceExplorerPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [runs, setRuns] = useState<Loadable<RunRecord[]>>({ status: 'loading' });
  const [detail, setDetail] = useState<Loadable<EvidenceDetail> | undefined>();

  useEffect(() => {
    void apiRequest<{ items: RunRecord[] }>('/api/runs')
      .then(({ items }) => {
        setRuns(items.length === 0 ? { status: 'empty' } : { status: 'ready', data: items });
      })
      .catch((error: unknown) => setRuns({ status: 'error', message: errorMessage(error) }));
  }, []);

  const requestedRunId = searchParams.get('runId');
  const selectedRunId =
    requestedRunId ?? (runs.status === 'ready' ? runs.data[0]?.runId : undefined);

  useEffect(() => {
    if (!selectedRunId) return;
    setDetail({ status: 'loading' });
    void Promise.all([
      apiRequest<RunRecord>(`/api/runs/${encodeURIComponent(selectedRunId)}`),
      apiRequest<EvidenceManifest>(`/api/runs/${encodeURIComponent(selectedRunId)}/evidence`),
      apiRequest<ExecutablePlan>(`/api/runs/${encodeURIComponent(selectedRunId)}/plan`),
    ])
      .then(async ([run, evidence, plan]) => {
        const [scenario, progress, inventory] = await Promise.all([
          apiRequest<Scenario>(`/api/scenarios/${encodeURIComponent(run.scenario.id)}`),
          run.runType === 'LIVE_API'
            ? apiRequest<RunProgress>(`/api/runs/${encodeURIComponent(run.runId)}/progress`)
            : Promise.resolve(undefined),
          run.runType === 'LIVE_API'
            ? apiRequest<ResourceInventory>(`/api/runs/${encodeURIComponent(run.runId)}/inventory`)
            : Promise.resolve(undefined),
        ]);
        setDetail({
          status: 'ready',
          data: {
            run,
            evidence,
            plan,
            scenario,
            ...(progress ? { progress } : {}),
            ...(inventory ? { inventory } : {}),
          },
        });
      })
      .catch((error: unknown) => {
        void Promise.all([
          apiRequest<RunProgress>(`/api/runs/${encodeURIComponent(selectedRunId)}/progress`),
          apiRequest<ResourceInventory>(`/api/runs/${encodeURIComponent(selectedRunId)}/inventory`),
          apiRequest<ExecutablePlan>(`/api/runs/${encodeURIComponent(selectedRunId)}/plan`),
        ])
          .then(([progress, inventory, plan]) =>
            setDetail({
              status: 'ready',
              data: { recovery: true, runId: selectedRunId, progress, inventory, plan },
            }),
          )
          .catch(() => setDetail({ status: 'error', message: errorMessage(error) }));
      });
  }, [selectedRunId]);

  const canShowDetail = runs.status === 'ready' || Boolean(requestedRunId);

  return (
    <>
      <PageHeader
        eyebrow="Sanitized run artifacts"
        title="Evidence Explorer"
        description="Inspect assurance scope, typed failures, compiled plan source links, and sanitized manifest entries."
      />
      {runs.status === 'loading' && <LoadingPanel label="Loading run evidence…" />}
      {runs.status === 'empty' && !requestedRunId && (
        <EmptyPanel message="Create a compile-only run in Run Center to produce evidence." />
      )}
      {runs.status === 'error' && <ErrorPanel message={runs.message} />}
      {canShowDetail && (
        <>
          {runs.status === 'ready' && runs.data.length > 0 && (
            <label className="run-selector">
              Run
              <select
                value={selectedRunId}
                onChange={(event) => setSearchParams({ runId: event.target.value })}
              >
                {runs.data.map((run) => (
                  <option key={run.runId} value={run.runId}>
                    {run.runId} · {run.verdict} · {run.assuranceScope}
                  </option>
                ))}
              </select>
            </label>
          )}
          {detail?.status === 'loading' && <LoadingPanel label="Loading selected run detail…" />}
          {detail?.status === 'empty' && <EmptyPanel message="The selected run has no detail." />}
          {detail?.status === 'error' && (
            <ErrorPanel title="Evidence BLOCKED or unavailable" message={detail.message} />
          )}
          {detail?.status === 'ready' && <EvidenceDetailView detail={detail.data} />}
        </>
      )}
    </>
  );
}

function EvidenceManifestSection({ evidence }: { evidence: EvidenceManifest }) {
  return (
    <section className="detail-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Sanitized artifact index</p>
          <h2>Evidence manifest</h2>
        </div>
        <span>{evidence.entries.length} entries</span>
      </div>
      <ul className="manifest-list">
        {evidence.entries.map((entry) => (
          <li key={entry.id}>
            <StatusBadge value={entry.kind} />
            <div>
              <strong>{entry.id}</strong>
              <code>{entry.path}</code>
              <small>{entry.mediaType}</small>
              {entry.sha256 && (
                <small>
                  SHA-256 <code>{entry.sha256}</code>
                </small>
              )}
            </div>
          </li>
        ))}
      </ul>
      <p className="sanitization-note">
        Sanitization applied: <strong>{evidence.sanitization.applied ? 'Yes' : 'No'}</strong>.
        Confidential field values are not displayed.
      </p>
    </section>
  );
}

function EvidenceDetailView({ detail }: { detail: EvidenceDetail }) {
  if ('recovery' in detail) {
    return (
      <div className="evidence-layout">
        <section className="scope-warning" role="status">
          <div className="status-pair">
            <StatusBadge value={detail.progress.status} />
            <StatusBadge value={detail.progress.verdict} />
          </div>
          <h2>Recovery-required live inventory</h2>
          <p>
            Final run artifacts are not committed for <code>{detail.runId}</code>. The durable
            checkpoint, observations, plan, and run-owned inventory remain available for operator
            recovery.
          </p>
        </section>
        <LivePendingPanel
          pending={{ runId: detail.runId, progress: detail.progress, inventory: detail.inventory }}
        />
        <section className="detail-section">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Durable plan retrieval</p>
              <h2>Compiled live plan</h2>
            </div>
            <span>{detail.plan.steps.length} steps</span>
          </div>
          <ol className="plan-entry-list">
            {detail.plan.steps.map((step) => (
              <li key={step.id}>
                <div>
                  <h3>{step.source.blueprintStepId.replaceAll('-', ' ')}</h3>
                  <p>{step.action}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      </div>
    );
  }
  const run = detail.run;
  if (run.runType === 'LIVE_API') {
    return (
      <div className="evidence-layout">
        <LiveRunResult result={detail} />
        <EvidenceManifestSection evidence={detail.evidence} />
      </div>
    );
  }
  const businessSteps = new Map(detail.scenario.steps.map((step) => [step.id, step]));
  const typedErrors = [
    ...(run.error ? [run.error] : []),
    ...run.stepResults.flatMap((step) => (step.error ? [step.error] : [])),
  ];

  return (
    <div className="evidence-layout">
      <section className="scope-warning">
        <div className="status-pair">
          <StatusBadge value={run.verdict} />
          <StatusBadge value={run.assuranceScope} />
        </div>
        <h2>Compile-only evidence · not a NILES release verdict</h2>
        <p>
          Gate eligible: <strong>No (gateEligible: false)</strong>. PASS means the versioned
          blueprint compiled and persisted within compilation scope only.
        </p>
        <dl className="id-list">
          <div>
            <dt>Run ID</dt>
            <dd>
              <code>{run.runId}</code>
            </dd>
          </div>
          <div>
            <dt>Correlation ID</dt>
            <dd>
              <code>{run.runId}</code> <small>(compile-only run scope)</small>
            </dd>
          </div>
          <div>
            <dt>Plan ID</dt>
            <dd>
              <code>{run.planId}</code>
            </dd>
          </div>
        </dl>
      </section>

      {typedErrors.length > 0 && (
        <section className="detail-section typed-errors" aria-label="Typed errors">
          <h2>Typed errors</h2>
          {typedErrors.map((error, index) => (
            <div className="typed-error" key={`${error.code}-${index}`}>
              <strong>
                {error.category} · {error.code}
              </strong>
              <p>{error.message}</p>
              <small>{error.retryable ? 'Retryable' : 'Not retryable'}</small>
            </div>
          ))}
        </section>
      )}

      <section className="detail-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Durable plan retrieval</p>
            <h2>Compiled plan entries</h2>
          </div>
          <StatusBadge value="not executed" />
        </div>
        <ol className="plan-entry-list">
          {detail.plan.steps.map((step) => {
            const businessStep = businessSteps.get(step.source.blueprintStepId);
            const resultStep = run.stepResults.find((result) => result.stepId === step.id);
            return (
              <li key={step.id}>
                <div>
                  <h3>{businessStep?.title ?? step.source.blueprintStepId}</h3>
                  <p>{businessStep?.narrative}</p>
                </div>
                <dl>
                  <div>
                    <dt>Actor</dt>
                    <dd>{step.actorId}</dd>
                  </div>
                  <div>
                    <dt>Source</dt>
                    <dd>{step.source.blueprintStepId}</dd>
                  </div>
                  <div>
                    <dt>Technical action</dt>
                    <dd>
                      <code>{step.action}</code>
                    </dd>
                  </div>
                  <div>
                    <dt>Compilation</dt>
                    <dd>
                      {resultStep ? (
                        <StatusBadge value={resultStep.compilationStatus} />
                      ) : (
                        'Unavailable'
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>NILES execution</dt>
                    <dd>
                      {resultStep ? (
                        <StatusBadge value={resultStep.executionStatus} />
                      ) : (
                        'Unavailable'
                      )}
                    </dd>
                  </div>
                </dl>
              </li>
            );
          })}
        </ol>
      </section>

      <section className="detail-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Sanitized artifact index</p>
            <h2>Evidence manifest</h2>
          </div>
          <span>{detail.evidence.entries.length} entries</span>
        </div>
        <ul className="manifest-list">
          {detail.evidence.entries.map((entry) => (
            <li key={entry.id}>
              <StatusBadge value={entry.kind} />
              <div>
                <strong>{entry.id}</strong>
                <code>{entry.path}</code>
                <small>{entry.mediaType}</small>
                {entry.sha256 && (
                  <small>
                    SHA-256 <code>{entry.sha256}</code>
                  </small>
                )}
              </div>
            </li>
          ))}
        </ul>
        <p className="sanitization-note">
          Sanitization applied:{' '}
          <strong>{detail.evidence.sanitization.applied ? 'Yes' : 'No'}</strong>. Confidential field
          values are not displayed.
        </p>
      </section>
    </div>
  );
}

function CoveragePage() {
  const [coverage, setCoverage] = useState<Loadable<CoverageResult>>({ status: 'loading' });

  useEffect(() => {
    void apiRequest<CoverageResult>('/api/coverage')
      .then((result) =>
        setCoverage(
          result.cells.length === 0 ? { status: 'empty' } : { status: 'ready', data: result },
        ),
      )
      .catch((error: unknown) => setCoverage({ status: 'error', message: errorMessage(error) }));
  }, []);

  return (
    <>
      <PageHeader
        eyebrow="Semantic planning matrix"
        title="Coverage"
        description="Declared scenario intent and compiled plan reach are shown separately from runtime execution."
      />
      <section className="coverage-legend" aria-label="Coverage state definitions">
        <div>
          <StatusBadge value="declared" />
          <p>Present in the reviewed business blueprint.</p>
        </div>
        <div>
          <StatusBadge value="compiled" />
          <p>Represented in a deterministic executable plan.</p>
        </div>
        <div>
          <StatusBadge value="not executed" />
          <p>No NILES runtime behavior has been exercised.</p>
        </div>
      </section>
      {coverage.status === 'loading' && <LoadingPanel label="Deriving semantic coverage…" />}
      {coverage.status === 'empty' && (
        <EmptyPanel message="No scenario coverage cells could be derived." />
      )}
      {coverage.status === 'error' && <ErrorPanel message={coverage.message} />}
      {coverage.status === 'ready' && (
        <>
          <section className="coverage-summary" aria-label="Coverage summary">
            <div>
              <strong>{coverage.data.summary.cells}</strong>
              <span>declared + compiled cells</span>
            </div>
            <div>
              <strong>{coverage.data.summary.executed}</strong>
              <span>runtime-executed cells</span>
            </div>
            <p>
              Runtime coverage is <strong>not claimed</strong> in M1-01.
            </p>
          </section>
          <div className="coverage-grid">
            {coverage.data.cells.map((cell) => {
              const hasSla = cell.assertionKinds.includes('SLA');
              const negativeAccess = cell.expectedOutcome === 'ACCESS_DENIED';
              return (
                <article className="coverage-cell" key={`${cell.scenarioId}-${cell.variation}`}>
                  <header>
                    <div>
                      <p className="eyebrow">{cell.scenarioId}</p>
                      <h2>{cell.variation.replace('=', ' · ').replaceAll('-', ' ')}</h2>
                    </div>
                    <StatusBadge value="not executed" />
                  </header>
                  <CoverageDimension label="Actors" values={cell.actors} />
                  <CoverageDimension label="Actions / transitions" values={cell.actions} />
                  <CoverageDimension label="Assertions" values={cell.assertionKinds} />
                  <div className="coverage-binary">
                    <span>SLA assertion</span>
                    <strong>{hasSla ? 'Declared · compiled' : 'Not declared'}</strong>
                  </div>
                  <div className="coverage-binary">
                    <span>Negative access</span>
                    <strong>{negativeAccess ? 'Declared · compiled' : 'Not declared'}</strong>
                  </div>
                </article>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}

function CoverageDimension({ label, values }: { label: string; values: string[] }) {
  return (
    <div className="coverage-dimension">
      <h3>{label}</h3>
      <ul>
        {values.map((value) => (
          <li key={value}>
            <span>{value}</span>
            <small>Declared · compiled · not executed</small>
          </li>
        ))}
      </ul>
    </div>
  );
}

function NotFoundPage() {
  return (
    <>
      <PageHeader
        eyebrow="Navigation error"
        title="Page not found"
        description="The requested console route does not exist."
      />
      <Link className="button button-primary" to="/scenarios">
        Return to Scenario Library
      </Link>
    </>
  );
}

export default function App() {
  return <Shell />;
}
