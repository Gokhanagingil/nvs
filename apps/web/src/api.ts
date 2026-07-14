interface ErrorEnvelope {
  error?: {
    code?: string;
    category?: string;
    message?: string;
  };
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly category: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: {
        accept: 'application/json',
        ...(init?.body ? { 'content-type': 'application/json' } : {}),
        ...init?.headers,
      },
    });
  } catch {
    throw new ApiError(
      'The local NVS control-plane API is unavailable.',
      'CONTROL_PLANE_UNAVAILABLE',
      'ENVIRONMENT',
      0,
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }

  if (!response.ok) {
    const envelope = body as ErrorEnvelope | undefined;
    throw new ApiError(
      envelope?.error?.message ?? 'The request could not be completed.',
      envelope?.error?.code ?? 'REQUEST_FAILED',
      envelope?.error?.category ?? 'ADAPTER',
      response.status,
    );
  }

  return body as T;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'An unexpected error occurred.';
}
