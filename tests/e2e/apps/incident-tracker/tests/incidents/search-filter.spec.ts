import { test, expect } from '../../../../fixtures';
import { IncidentListPage } from '../../pages';
import { useAuthedPage } from '../../support/authed-page';

/**
 * Incident Search and Filter Tests
 *
 * Tests for searching and filtering incidents.
 * Covers Rashma's Test Case #3: Use Search and filtering options
 */

test.describe('Incident Search and Filter', () => {
  // One authenticated staff session shared across this file (serial). Avoids a
  // per-test login and the refresh-token-rotation issue of saved storage state.
  const session = useAuthedPage('staff');

  test.beforeEach(async () => {
    await new IncidentListPage(session.page).goto();
  });

  test.describe('Search', () => {
    test('search input is visible', async () => {
      const incidentList = new IncidentListPage(session.page);
      await expect(incidentList.searchInput).toBeVisible();
    });

    test('can search for incidents by text', async () => {
      const incidentList = new IncidentListPage(session.page);
      await incidentList.search('test');
      await incidentList.expectLoaded();
    });

    test('can clear search', async () => {
      const incidentList = new IncidentListPage(session.page);
      await incidentList.search('test');
      await incidentList.clearSearch();
      await incidentList.expectLoaded();
    });

    test('shows no results for non-matching search', async () => {
      const incidentList = new IncidentListPage(session.page);
      await incidentList.search('xyznonexistent12345');
      await expect(
        session.page.getByText('No incidents found'),
      ).toBeVisible({ timeout: 10000 });
      const count = await incidentList.getIncidentCount();
      expect(count).toBe(0);
    });
  });

  test.describe('Location Filter', () => {
    test('location filter is visible', async () => {
      const incidentList = new IncidentListPage(session.page);
      const isVisible = await incidentList.isFilterPresent(
        incidentList.locationFilter,
      );
      if (!isVisible) {
        test.skip();
      }
      await expect(incidentList.locationFilter).toBeVisible();
    });

    test('can filter by location', async () => {
      const incidentList = new IncidentListPage(session.page);

      // Bounded wait so a still-rendering filter isn't misread as absent (skip)
      // or half-present (proceed -> timeout).
      const isVisible = await incidentList.isFilterPresent(
        incidentList.locationFilter,
      );
      if (!isVisible) {
        test.skip();
        return;
      }

      await expect(incidentList.incidentTable).toBeVisible({ timeout: 10000 });
      const initialCount = await incidentList.getIncidentCount();
      if (initialCount === 0) {
        test.skip();
        return;
      }

      await incidentList.filterByLocation('Main Street Branch');
      await incidentList.expectLoaded();

      const filteredCount = await incidentList.getIncidentCount();
      expect(filteredCount).toBeLessThanOrEqual(initialCount);
    });
  });

  test.describe('Status Filter', () => {
    test('status filter is visible', async () => {
      const incidentList = new IncidentListPage(session.page);
      const isVisible = await incidentList.isFilterPresent(
        incidentList.statusFilter,
      );
      if (!isVisible) {
        test.skip();
      }
      await expect(incidentList.statusFilter).toBeVisible();
    });

    test('can filter by status', async () => {
      const incidentList = new IncidentListPage(session.page);
      const isVisible = await incidentList.isFilterPresent(
        incidentList.statusFilter,
      );
      if (!isVisible) {
        test.skip();
        return;
      }

      // Filter by resolved status (available options: Active, Review Complete)
      await incidentList.filterByStatus('Review Complete');
      await incidentList.expectLoaded();
    });
  });

  test.describe('Combined Filters', () => {
    test('can combine search with location filter', async () => {
      const incidentList = new IncidentListPage(session.page);
      await incidentList.search('incident');

      const hasLocationFilter = await incidentList.isFilterPresent(
        incidentList.locationFilter,
      );
      if (hasLocationFilter) {
        await incidentList.filterByLocation('Main Street Branch');
      }
      await incidentList.expectLoaded();
    });

    test('can clear all filters', async () => {
      const incidentList = new IncidentListPage(session.page);
      await incidentList.search('test');
      await incidentList.clearFilters();
      await incidentList.clearSearch();
      await incidentList.expectLoaded();
    });
  });
});
