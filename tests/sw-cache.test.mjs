import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../web/sw.js', import.meta.url), 'utf8');

function worker({fetch, cache} = {}) {
  const handlers = new Map();
  const pending = [];
  let activated = false;
  const context = vm.createContext({
    URL, Request, Response, Promise, Date, setTimeout, clearTimeout,
    location: {origin: 'https://example.org'},
    self: {
      registration: {scope: 'https://example.org/kael/'},
      addEventListener: (name, handler) => handlers.set(name, handler),
      skipWaiting: async () => { activated = true; },
      clients: {claim: async () => {}},
    },
    caches: {open: async () => cache},
    fetch,
  });
  vm.runInContext(`${source}\nglobalThis.networkFirstForTest = networkFirst;`, context);
  return {
    handlers,
    event: {request: new Request('https://example.org/kael/app.js?v=new'), waitUntil: p => pending.push(p)},
    networkFirst: context.networkFirstForTest,
    settled: () => Promise.all(pending),
    activated: () => activated,
  };
}

test('online shell requests revalidate the HTTP cache before saving fresh bytes', async () => {
  let requested, saved;
  const w = worker({
    fetch: async (request, options) => {
      requested = {request, options};
      return new Response('new release');
    },
    cache: {
      match: async () => new Response('previous release'),
      put: async (_request, response) => { saved = await response.text(); },
    },
  });
  const response = await w.networkFirst(w.event, 'shell');
  assert.equal(await response.text(), 'new release');
  assert.equal(requested.options?.cache ?? requested.request.cache, 'no-cache');
  await w.settled();
  assert.equal(saved, 'new release');
});

test('offline shell requests still recover the stored copy', async () => {
  let matchOptions;
  const w = worker({
    fetch: async () => { throw new TypeError('offline'); },
    cache: {match: async (_request, options) => {
      matchOptions = options;
      return new Response('offline copy');
    }},
  });
  const response = await w.networkFirst(w.event, 'shell');
  assert.equal(await response.text(), 'offline copy');
  assert.equal(matchOptions.ignoreSearch, true);
  await w.settled();
});

test('a new worker precaches shell files without reusing stale HTTP-cache entries', async () => {
  let requested;
  const w = worker({
    cache: {addAll: async requests => { requested = requests; }},
  });
  w.handlers.get('install')(w.event);
  await w.settled();
  assert.ok(requested.length > 0);
  for (const request of requested) {
    assert.equal(request.cache, 'reload');
    assert.ok(request.url.startsWith('https://example.org/kael/'));
  }
  assert.equal(w.activated(), true);
});
