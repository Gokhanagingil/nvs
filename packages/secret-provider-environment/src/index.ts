import {
  AuthenticationBlockedError,
  type AuthenticationCredential,
  type SecretConfigurationStatus,
  type SecretProvider,
} from '@nvs/core';

const CREDENTIAL_REFERENCE_PATTERN = /^[a-z][a-z0-9.-]{1,127}$/;
const LOGIN_IDENTIFIER_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function credentialEnvironmentVariable(reference: string): string {
  if (!CREDENTIAL_REFERENCE_PATTERN.test(reference)) {
    throw new AuthenticationBlockedError(
      'CREDENTIAL_REFERENCE_INVALID',
      'The symbolic actor credential reference is invalid.',
      false,
      'ENVIRONMENT',
    );
  }
  const encoded = reference.toUpperCase().replaceAll('.', '_DOT_').replaceAll('-', '_DASH_');
  return `NVS_CREDENTIAL_${encoded}`;
}

function parseCredential(rawValue: string): { email: string; password: string } | undefined {
  let value: unknown;
  try {
    value = JSON.parse(rawValue);
  } catch {
    return undefined;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).sort().join(',') !== 'email,password' ||
    typeof record['email'] !== 'string' ||
    typeof record['password'] !== 'string'
  ) {
    return undefined;
  }
  const email = record['email'].trim();
  const password = record['password'];
  if (
    !LOGIN_IDENTIFIER_PATTERN.test(email) ||
    email.length > 254 ||
    password.length < 6 ||
    password.length > 512
  ) {
    return undefined;
  }
  return { email, password };
}

class EnvironmentActorCredential implements AuthenticationCredential {
  #email: string;
  #password: string;
  #destroyed = false;

  constructor(email: string, password: string) {
    this.#email = email;
    this.#password = password;
  }

  async use<T>(operation: (email: string, password: string) => Promise<T>): Promise<T> {
    if (this.#destroyed) {
      throw new AuthenticationBlockedError(
        'CREDENTIAL_DESTROYED',
        'The actor credential is no longer available.',
        false,
        'ENVIRONMENT',
      );
    }
    return operation(this.#email, this.#password);
  }

  destroy(): void {
    this.#email = '';
    this.#password = '';
    this.#destroyed = true;
  }

  toJSON(): string {
    return '[REDACTED]';
  }
}

export class EnvironmentVariableSecretProvider implements SecretProvider {
  readonly #source: Readonly<Record<string, string | undefined>>;

  constructor(source: Readonly<Record<string, string | undefined>> = process.env) {
    this.#source = source;
  }

  async configurationStatus(reference: string): Promise<SecretConfigurationStatus> {
    const rawValue = this.#source[credentialEnvironmentVariable(reference)]?.trim();
    if (!rawValue) {
      return 'MISSING';
    }
    return parseCredential(rawValue) ? 'CONFIGURED' : 'INVALID';
  }

  async resolve(reference: string): Promise<AuthenticationCredential> {
    const rawValue = this.#source[credentialEnvironmentVariable(reference)]?.trim();
    if (!rawValue) {
      throw new AuthenticationBlockedError(
        'CREDENTIAL_MISSING',
        'The actor credential reference is not configured.',
        false,
        'ENVIRONMENT',
      );
    }
    const credential = parseCredential(rawValue);
    if (!credential) {
      throw new AuthenticationBlockedError(
        'CREDENTIAL_INVALID',
        'The actor credential configuration is invalid.',
        false,
        'ENVIRONMENT',
      );
    }
    return new EnvironmentActorCredential(credential.email, credential.password);
  }
}
