import * as path from 'node:path';
import type { APIRequestContext, Locator, Page } from '@playwright/test';
import { TEST_USERS, type TestUserRole } from '../fixtures';
import { LoginPage } from '../apps/incident-tracker/pages';

const REPO_ROOT = path.resolve(__dirname, '../../..');

/** Stable uuids of seeded org units and users (platform demo seed and
 * tests/fixtures/fixtures.json). */
export const ORG = {
  MAIN: '5eed0000-0000-4000-a000-000000000204',
  RIVR: '5eed0000-0000-4000-a000-000000000205',
  LAKE: '5eed0000-0000-4000-a000-000000000207',
} as const;

export const USER_UUID = {
  coordinator: 'e2e00000-0000-4000-a000-000000000201',
  manager: 'e2e00000-0000-4000-a000-000000000202',
} as const;

/** Where a feature's images go: docs/generated/<feature>/<name>. */
export function imagePath(feature: string, name: string): string {
  return path.join(REPO_ROOT, 'docs', 'generated', feature, name);
}

/** Minimal API client for capture setup, authenticated as a test user. */
export class Api {
  private constructor(
    private readonly request: APIRequestContext,
    private readonly token: string,
  ) {}

  static async login(request: APIRequestContext, role: TestUserRole): Promise<Api> {
    const user = TEST_USERS[role];
    const resp = await request.post('/api/v1/odo/auth/login', {
      data: { username: user.username, password: user.password },
    });
    if (!resp.ok()) throw new Error(`login ${user.username}: ${resp.status()}`);
    return new Api(request, (await resp.json()).access_token);
  }

  async current<T = any>(endpoint: string, data: unknown): Promise<T> {
    const resp = await this.request.post(`/api/v1/current/${endpoint}`, {
      data,
      headers: { Authorization: `Bearer ${this.token}` },
    });
    if (!resp.ok()) {
      throw new Error(`${endpoint}: ${resp.status()} ${await resp.text()}`);
    }
    return resp.json();
  }

  async templateId(name: string): Promise<number> {
    const templates = await this.current<{ id: number; name: string }[]>('template/list', {});
    const t = templates.find((x) => x.name === name);
    if (!t) throw new Error(`no incident template named ${name}`);
    return t.id;
  }
}

/** Log in through the UI and land on the dashboard. */
export async function uiLogin(page: Page, role: TestUserRole): Promise<void> {
  const user = TEST_USERS[role];
  const login = new LoginPage(page);
  await login.goto();
  await login.loginAndWaitForDashboard(user.username, user.password);
}

/**
 * Screenshot the region around one or more elements: their combined
 * bounding box, padded, and widened to `within` (typically the page's
 * main card) so crops line up with the layout instead of hugging a field.
 */
export async function captureRegion(
  page: Page,
  file: string,
  targets: Locator[],
  opts: { within?: Locator; pad?: number } = {},
): Promise<void> {
  const pad = opts.pad ?? 16;
  for (const t of targets) await t.scrollIntoViewIfNeeded();
  const boxes = await Promise.all(targets.map((t) => t.boundingBox()));
  if (boxes.some((b) => b === null)) throw new Error(`capture ${file}: target not visible`);
  const bs = boxes as NonNullable<(typeof boxes)[number]>[];
  let x0 = Math.min(...bs.map((b) => b.x)) - pad;
  let x1 = Math.max(...bs.map((b) => b.x + b.width)) + pad;
  const y0 = Math.min(...bs.map((b) => b.y)) - pad;
  const y1 = Math.max(...bs.map((b) => b.y + b.height)) + pad;
  if (opts.within) {
    const w = await opts.within.boundingBox();
    if (w) {
      x0 = w.x;
      x1 = w.x + w.width;
    }
  }
  // fullPage coordinates: bounding boxes are viewport-relative.
  const scrollY = await page.evaluate(() => window.scrollY);
  await page.screenshot({
    path: file,
    fullPage: true,
    clip: { x: Math.max(0, x0), y: Math.max(0, y0 + scrollY), width: x1 - Math.max(0, x0), height: y1 - y0 },
    animations: 'disabled',
    caret: 'hide',
  });
}
