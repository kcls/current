import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './app';

import { authApi, configureTokenRefresh, configureApiHostPort } from '@core';

// Configure API host:port from Vite environment variable
// This must be done before any API calls are made
if (import.meta.env.VITE_API_HOSTPORT) {
  configureApiHostPort(import.meta.env.VITE_API_HOSTPORT);
}

// Configure token refresh for proactive access token renewal
// Use silent: true to avoid triggering sessionExpired$ on background refresh failures
configureTokenRefresh({
  getAccessTokenExpirationTime: () => authApi.getAccessTokenExpirationTime(),
  refreshToken: () => authApi.refreshToken(undefined, { silent: true }),
});

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);
root.render(
  <App />
);

// If you want to start measuring performance in your app, pass a function
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
