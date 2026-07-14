import {
  EnvironmentVariableSecretProvider,
  credentialEnvironmentVariable,
} from '@nvs/secret-provider-environment';
import { describe, expect, it } from 'vitest';

const reference = 'niles.local.service-desk-agent';
const variableName = 'NVS_CREDENTIAL_NILES_DOT_LOCAL_DOT_SERVICE_DASH_DESK_DASH_AGENT';

describe('environment-variable secret provider', () => {
  it('uses a deterministic collision-resistant variable convention', () => {
    expect(credentialEnvironmentVariable(reference)).toBe(variableName);
    expect(credentialEnvironmentVariable('niles.local.service.desk-agent')).not.toBe(variableName);
  });

  it('distinguishes missing, invalid, and configured credentials without enumeration', async () => {
    const missing = new EnvironmentVariableSecretProvider({});
    const invalid = new EnvironmentVariableSecretProvider({
      [variableName]: JSON.stringify({ email: 'actor@example.invalid' }),
    });
    const configured = new EnvironmentVariableSecretProvider({
      [variableName]: JSON.stringify({
        email: 'actor@example.invalid',
        password: 'synthetic-test-value',
      }),
    });

    await expect(missing.configurationStatus(reference)).resolves.toBe('MISSING');
    await expect(invalid.configurationStatus(reference)).resolves.toBe('INVALID');
    await expect(configured.configurationStatus(reference)).resolves.toBe('CONFIGURED');
    expect(Object.keys(configured)).toEqual([]);
    expect(JSON.stringify(configured)).toBe('{}');
  });

  it('keeps resolved values out of serialization and destroys them after use', async () => {
    const provider = new EnvironmentVariableSecretProvider({
      [variableName]: JSON.stringify({
        email: 'actor@example.invalid',
        password: 'synthetic-test-value',
      }),
    });
    const credential = await provider.resolve(reference);

    await expect(
      credential.use(async (email, password) => `${email}:${password.length}`),
    ).resolves.toBe('actor@example.invalid:20');
    expect(JSON.stringify(credential)).toBe('"[REDACTED]"');

    credential.destroy();
    await expect(credential.use(async () => 'unexpected')).rejects.toMatchObject({
      code: 'CREDENTIAL_DESTROYED',
    });
  });
});
