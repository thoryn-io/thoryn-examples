'use strict';

// Unit test for RP-Initiated Logout URL building (SSO-2897). Uses only the Node
// standard library test runner — run with `npm test` (i.e. `node --test`).
//
// server.js checks THORYN_ISSUER / THORYN_CLIENT_ID at load and exits if unset,
// so we provide throwaway values before requiring it. The `require.main` guard
// in server.js means requiring the module does NOT start the HTTP server.

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.THORYN_ISSUER = process.env.THORYN_ISSUER || 'https://ex-signin-test.hub.example.org';
process.env.THORYN_CLIENT_ID = process.env.THORYN_CLIENT_ID || 'app-TEST0000';

const { buildEndSessionUrl } = require('./server.js');

test('buildEndSessionUrl carries id_token_hint, post_logout_redirect_uri and state', () => {
  const endSession = 'https://ex-signin-test.hub.example.org/connect/logout';
  const idToken = 'header.payload.signature';
  const postLogout = 'http://127.0.0.1:8471/';
  const state = 'abc123state';

  const urlStr = buildEndSessionUrl(endSession, idToken, postLogout, state);
  const url = new URL(urlStr);

  // It targets the discovered end-session endpoint...
  assert.equal(`${url.origin}${url.pathname}`, endSession);
  // ...and RP-Initiated Logout requires these query params, correctly encoded.
  assert.equal(url.searchParams.get('id_token_hint'), idToken);
  assert.equal(url.searchParams.get('post_logout_redirect_uri'), postLogout);
  assert.equal(url.searchParams.get('state'), state);
});

test('buildEndSessionUrl percent-encodes the loopback redirect', () => {
  const urlStr = buildEndSessionUrl(
    'https://hub.example.org/connect/logout',
    'a.b.c',
    'http://127.0.0.1:8471/',
    's',
  );
  // The raw string must not contain a bare "http://127.0.0.1" in the query — it
  // has to be percent-encoded so the hub parses one post_logout_redirect_uri.
  assert.match(urlStr, /post_logout_redirect_uri=http%3A%2F%2F127\.0\.0\.1%3A8471%2F/);
});
