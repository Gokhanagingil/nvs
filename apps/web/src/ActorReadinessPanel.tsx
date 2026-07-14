import { useEffect, useState } from 'react';
import { ApiError, apiRequest, errorMessage } from './api.js';
import type { ActorList, ActorReadiness, AuthPreflight, EnvironmentDefinition } from './types.js';

type ActorLoadState =
  | { status: 'loading' }
  | { status: 'empty' }
  | { status: 'error'; message: string; code?: string }
  | { status: 'ready'; data: ActorList };

type PreflightState =
  | { status: 'loading' }
  | { status: 'error'; message: string; code?: string }
  | { status: 'ready'; data: AuthPreflight };

function StatusBadge({ value }: { value: string }) {
  return (
    <span className={`status status-${value.toLowerCase().replaceAll('_', '-')}`}>{value}</span>
  );
}

function ActorRow({ actor }: { actor: ActorReadiness }) {
  return (
    <li className="actor-readiness-row">
      <div>
        <strong>{actor.displayName}</strong>
        <span>{actor.persona.replaceAll('-', ' ')}</span>
      </div>
      <div className="status-pair">
        <StatusBadge value={actor.credentialConfiguration} />
        <StatusBadge value={actor.authenticationState} />
      </div>
      <dl>
        {actor.expectedTenantId && (
          <div>
            <dt>Expected tenant</dt>
            <dd>
              <code>{actor.expectedTenantId}</code>
            </dd>
          </div>
        )}
        {actor.observedTenantId && (
          <div>
            <dt>Observed tenant</dt>
            <dd>
              <code>{actor.observedTenantId}</code>
            </dd>
          </div>
        )}
        {actor.userId && (
          <div>
            <dt>User ID</dt>
            <dd>
              <code>{actor.userId}</code>
            </dd>
          </div>
        )}
        {actor.durationMs !== undefined && (
          <div>
            <dt>Duration</dt>
            <dd>{actor.durationMs} ms</dd>
          </div>
        )}
      </dl>
      {actor.error && (
        <div className="typed-error" role="status">
          <strong>
            {actor.error.category} · {actor.error.code}
          </strong>
          <p>{actor.error.message}</p>
        </div>
      )}
    </li>
  );
}

export function ActorReadinessPanel({ environment }: { environment: EnvironmentDefinition }) {
  const [actors, setActors] = useState<ActorLoadState>({ status: 'loading' });
  const [preflight, setPreflight] = useState<PreflightState>();

  useEffect(() => {
    if (environment.kind === 'production') {
      setActors({ status: 'empty' });
      setPreflight(undefined);
      return;
    }
    setActors({ status: 'loading' });
    setPreflight(undefined);
    void apiRequest<ActorList>(`/api/environments/${encodeURIComponent(environment.id)}/actors`)
      .then((result) =>
        setActors(
          result.actors.length === 0 ? { status: 'empty' } : { status: 'ready', data: result },
        ),
      )
      .catch((error: unknown) =>
        setActors({
          status: 'error',
          message: errorMessage(error),
          ...(error instanceof ApiError ? { code: error.code } : {}),
        }),
      );
  }, [environment.id, environment.kind]);

  const runPreflight = async () => {
    setPreflight({ status: 'loading' });
    try {
      const result = await apiRequest<AuthPreflight>(
        `/api/environments/${encodeURIComponent(environment.id)}/auth-preflight`,
        { method: 'POST', body: '{}' },
      );
      setPreflight({ status: 'ready', data: result });
    } catch (error) {
      setPreflight({
        status: 'error',
        message: errorMessage(error),
        ...(error instanceof ApiError ? { code: error.code } : {}),
      });
    }
  };

  const displayedActors =
    preflight?.status === 'ready'
      ? preflight.data.actors
      : actors.status === 'ready'
        ? actors.data.actors
        : [];
  const configuredCount = displayedActors.filter(
    (actor) => actor.credentialConfiguration === 'CONFIGURED',
  ).length;
  const preflightForbidden = environment.kind === 'production' || !environment.enabled;
  const preflightReason =
    environment.kind === 'production'
      ? 'Authentication preflight is forbidden for production environments.'
      : !environment.enabled
        ? 'Enable this approved non-production environment before authentication preflight.'
        : 'Authentication uses independent in-memory sessions and creates no Incident records.';

  return (
    <section className="actor-readiness" aria-labelledby={`actors-${environment.id}`}>
      <header>
        <div>
          <p className="eyebrow">Synthetic actor readiness</p>
          <h3 id={`actors-${environment.id}`}>Actor sessions</h3>
        </div>
        {actors.status === 'ready' && (
          <span>
            {configuredCount}/{actors.data.actors.length} configured
          </span>
        )}
      </header>

      <p className="actor-safety-note" id={`preflight-policy-${environment.id}`}>
        {preflightReason} Passwords and tokens are never returned to this console.
      </p>

      <button
        className="button button-primary"
        type="button"
        aria-describedby={`preflight-policy-${environment.id}`}
        disabled={
          preflightForbidden || actors.status !== 'ready' || preflight?.status === 'loading'
        }
        onClick={() => void runPreflight()}
      >
        {preflight?.status === 'loading'
          ? 'Running authentication preflight…'
          : 'Run authentication preflight'}
      </button>

      {actors.status === 'loading' && (
        <p className="muted" aria-live="polite">
          Loading actor profiles…
        </p>
      )}
      {actors.status === 'empty' && (
        <p className="muted">No synthetic actor profiles are mapped to this environment.</p>
      )}
      {actors.status === 'error' && (
        <div className="typed-error" role="alert">
          <strong>Actor configuration unavailable{actors.code ? ` · ${actors.code}` : ''}</strong>
          <p>{actors.message}</p>
        </div>
      )}
      {preflight?.status === 'error' && (
        <div className="typed-error" role="alert">
          <strong>
            Authentication preflight unavailable{preflight.code ? ` · ${preflight.code}` : ''}
          </strong>
          <p>{preflight.message}</p>
        </div>
      )}
      {preflight?.status === 'ready' && (
        <div className="preflight-summary" role="status" aria-live="polite">
          <StatusBadge value={preflight.data.verdict} />
          <strong>Authentication readiness only · not release-gate eligible</strong>
          <span>gateEligible: false</span>
        </div>
      )}
      {displayedActors.length > 0 && (
        <ul className="actor-readiness-list">
          {displayedActors.map((actor) => (
            <ActorRow actor={actor} key={actor.actorProfileId} />
          ))}
        </ul>
      )}
    </section>
  );
}
