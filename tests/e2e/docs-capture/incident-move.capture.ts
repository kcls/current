import * as fs from 'node:fs';
import * as path from 'node:path';
import { test, expect, type APIRequestContext } from '@playwright/test';
import { Api, ORG, USER_UUID, captureRegion, imagePath, uiLogin } from './support';

/**
 * Images for docs/incident-move.md: moving an in-review incident from Main
 * Street Branch (seeded two-level chain; e2e.current.manager reviews at
 * level 1) to Lakeside Branch, where it is resubmitted at level 1.
 *
 * Setup leaves Lakeside with a one-level chain (e2e.current.coord, final)
 * if it had none. No e2e test uses Lakeside; Riverside must stay
 * chainless, so it is not used here. The demo incident is deleted after
 * the run.
 */
const FEATURE = 'incident-move';
const shot = (name: string) => imagePath(FEATURE, name);

test.describe.configure({ mode: 'serial' });

let api: APIRequestContext;
let incidentId: number | undefined;
let admin: Api;

// A context of our own: Playwright's request fixture cannot outlive the hook
// that received it, and cleanup runs in afterAll.
test.beforeAll(async ({ playwright, baseURL }) => {
  fs.mkdirSync(path.dirname(shot('x')), { recursive: true });
  api = await playwright.request.newContext({ baseURL, ignoreHTTPSErrors: true });

  admin = await Api.login(api, 'admin');
  const hasChain = await admin.current<boolean>('review-chain/has', { org_unit: ORG.LAKE });
  if (!hasChain) {
    await admin.current('review-chain/save', {
      org_unit: ORG.LAKE,
      levels: [{ members: [{ usr: USER_UUID.coordinator }] }],
    });
  }

  const staff = await Api.login(api, 'staff');
  const created = await staff.current<{ id: number }>('incident/create', {
    org_unit: ORG.MAIN,
    title: 'Disturbance',
    description: 'Patron was loud and disruptive near the public computers and refused to lower their voice when asked.',
    template_ids: [await staff.templateId('Disturbance')],
    occurred_at: '2026-03-12T14:30:00-07:00',
    involved_parties: [{ party_type: 'patron', is_unknown_patron: true, role: 'subject' }],
  });
  incidentId = created.id;
  await staff.current('incident/review/create', { incident: incidentId, result: 'submitted' });
});

test.afterAll(async () => {
  if (incidentId) {
    await admin.current('incident/update', { id: incidentId, is_deleted: true });
  }
  await api?.dispose();
});

test('move an in-review incident', async ({ page }) => {
  // The level-1 reviewer at Main Street: staff cannot edit an incident in review.
  await uiLogin(page, 'manager');

  await page.goto(`/incident-tracker/incidents/${incidentId}/edit`);
  await page.getByRole('heading', { name: 'Edit Incident' }).waitFor();
  await page.waitForLoadState('networkidle');
  const card = page.locator('.MuiPaper-root', { has: page.getByRole('heading', { name: 'Edit Incident' }) });

  const location = page.getByRole('combobox', { name: 'Location' });
  await location.click();
  await location.fill('Lakeside');
  await page.getByRole('option', { name: /Lakeside Branch/ }).click();
  await page.waitForLoadState('networkidle');
  // Drop focus so the field shows its resting "moving" state, not a caret.
  await page.getByRole('heading', { name: 'Edit Incident' }).click();

  const hint = page.getByText(/^Saving moves this incident from/);
  await expect(hint).toBeVisible();
  await captureRegion(page, shot('01-change-location.png'), [location, hint], { within: card });

  const warning = page.locator('.MuiAlert-root', { hasText: 'This incident is in review' });
  const saveAndMove = page.getByRole('button', { name: 'Save & Move' });
  await expect(warning).toBeVisible();
  await captureRegion(page, shot('02-save-and-move.png'), [warning, saveAndMove], { within: card });

  await saveAndMove.click();
  const toast = page.locator('.MuiSnackbar-root .MuiAlert-root', { hasText: 'moved and resubmitted' });
  await expect(toast).toBeVisible();
  await captureRegion(page, shot('03-moved.png'), [toast], { pad: 0 });
  await toast.getByRole('button', { name: /close/i }).click();
  await expect(toast).toBeHidden();

  await page.waitForURL(new RegExp(`/incidents/${incidentId}$`));
  await page.waitForLoadState('networkidle');
  const reviewHeading = page.getByRole('heading', { name: 'Review History' });
  await reviewHeading.waitFor();
  const reviewCard = page.locator('.MuiPaper-root, .MuiCard-root', { has: reviewHeading }).last();
  await captureRegion(page, shot('04-review-history.png'), [reviewCard], { pad: 0 });
});
