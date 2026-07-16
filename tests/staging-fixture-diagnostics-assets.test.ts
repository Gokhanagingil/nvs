import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowPath = path.join(process.cwd(), '.github', 'workflows', 'staging-fixture.yml');

describe('staging fixture diagnostic artifact', () => {
  it('uploads only the sanitized operator result with short retention', () => {
    const workflow = readFileSync(workflowPath, 'utf8');

    expect(workflow).toContain('name: Upload sanitized fixture result');
    expect(workflow).toContain('if: always()');
    expect(workflow).toContain('actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02');
    expect(workflow).toContain('path: ${{ runner.temp }}/nvs-staging-fixture.md');
    expect(workflow).toContain('retention-days: 1');
    expect(workflow).toContain('if-no-files-found: ignore');
    expect(workflow).not.toContain('path: /opt/nvs');
    expect(workflow).not.toContain('path: ${{ runner.temp }}/.env');
  });
});
