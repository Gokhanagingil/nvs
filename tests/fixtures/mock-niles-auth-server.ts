import { createServer } from 'node:http';
import type { IncomingMessage } from 'node:http';

const port = Number(process.env['NVS_MOCK_NILES_PORT'] ?? '4310');
const host = '127.0.0.1';
const primaryTenant = '11111111-1111-4111-8111-111111111111';
const requesterUserId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const serviceDeskUserId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const crossTenantUserId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

async function requestBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

const server = createServer(async (request, response) => {
  if (request.method === 'GET' && request.url === '/health/live') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ status: 'ok' }));
    return;
  }
  if (request.method !== 'POST' || request.url !== '/auth/login') {
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'not-found' }));
    return;
  }

  let email = '';
  try {
    const body = JSON.parse(await requestBody(request)) as { email?: unknown };
    email = typeof body.email === 'string' ? body.email : '';
  } catch {
    response.writeHead(400, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'invalid-request' }));
    return;
  }

  response.setHeader('content-type', 'application/json');
  if (email.startsWith('requester')) {
    response.writeHead(200);
    response.end(
      JSON.stringify({
        accessToken: 'mock-requester-token',
        user: { id: requesterUserId, tenantId: primaryTenant },
      }),
    );
    return;
  }
  if (email.startsWith('service-desk-agent')) {
    response.writeHead(200);
    response.end(
      JSON.stringify({
        success: true,
        data: {
          accessToken: 'mock-service-desk-token',
          user: { id: serviceDeskUserId, tenantId: primaryTenant },
        },
      }),
    );
    return;
  }
  if (email.startsWith('incident-manager')) {
    response.writeHead(200);
    response.end(JSON.stringify({ mfaRequired: true, mfaToken: 'mock-mfa-token' }));
    return;
  }
  if (email.startsWith('tenant-admin')) {
    response.writeHead(200);
    response.end(JSON.stringify({ success: true, data: 'malformed-login-response' }));
    return;
  }
  if (email.startsWith('cross-tenant-agent')) {
    response.writeHead(200);
    response.end(
      JSON.stringify({
        accessToken: 'mock-cross-tenant-token',
        user: { id: crossTenantUserId, tenantId: primaryTenant },
      }),
    );
    return;
  }

  response.writeHead(401);
  response.end(JSON.stringify({ error: 'denied' }));
});

server.listen(port, host, () => {
  process.stdout.write(`MOCK_NILES_READY http://${host}:${port}\n`);
});

const shutdown = () => server.close(() => process.exit(0));
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
