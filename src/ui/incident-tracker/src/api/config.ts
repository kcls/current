/**
 * API Configuration
 * Sets up base configuration for @core API utilities
 */

import { authApi as coreAuthApi } from '@core';

// Helper to get auth token from localStorage
export const getAuthToken = (): string | null => {
  return coreAuthApi.getAuthToken();
  /*
  if (typeof window !== 'undefined') {
    // Check both keys for backward compatibility
    return localStorage.getItem('access_token') || localStorage.getItem('authToken');
  }
  return null;
  */
};

// Helper to set auth token
/*
export const setAuthToken = (token: string): void => {
  if (typeof window !== 'undefined') {
    // Store under both keys for compatibility
    localStorage.setItem('access_token', token);
    localStorage.setItem('authToken', token);
  }
};

// Helper to clear auth token
export const clearAuthToken = (): void => {
  if (typeof window !== 'undefined') {
    localStorage.removeItem('access_token');
    localStorage.removeItem('authToken');
  }
};
*/

