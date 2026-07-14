import path from 'node:path';
import { chromium } from '@playwright/test';

const baseUrl = process.env['NVS_WEB_URL'] ?? 'http://127.0.0.1:4173';
const outputRoot = path.resolve(process.cwd(), 'docs', 'assets');
const browser = await chromium.launch();

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

  await page.goto(`${baseUrl}/scenarios`);
  await page.getByRole('heading', { name: 'Human-readable journey' }).waitFor();
  await page.screenshot({
    path: path.join(outputRoot, 'm1-01-scenario-library.png'),
    fullPage: true,
  });

  await page.getByRole('link', { name: 'Run Center' }).click();
  await page.getByRole('button', { name: 'Launch compile-only run' }).click();
  await page.getByText('Not release-gate eligible · gateEligible: false').waitFor();
  await page.screenshot({
    path: path.join(outputRoot, 'm1-01-compile-only-run.png'),
    fullPage: true,
  });

  await page.getByRole('link', { name: 'View evidence' }).click();
  await page.getByRole('heading', { name: 'Evidence manifest' }).waitFor();
  await page.screenshot({
    path: path.join(outputRoot, 'm1-01-evidence-explorer.png'),
    fullPage: true,
  });
} finally {
  await browser.close();
}
