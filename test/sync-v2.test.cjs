const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
require('fake-indexeddb/auto');

const repositoryRoot = path.resolve(__dirname, '..');
process.env.NODE_PATH = [path.join(repositoryRoot, 'node_modules'), process.env.NODE_PATH]
  .filter(Boolean)
  .join(path.delimiter);
require('node:module').Module._initPaths();

const buildDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'vine-sync-v2-'));
const compiler = path.join(repositoryRoot, 'node_modules', 'typescript', 'bin', 'tsc');
const sourceFiles = [
  'types.ts',
  'utils/dateUtils.ts',
  'utils/productCompatibility.ts',
  'utils/syncTypes.ts',
  'utils/syncCanonical.ts',
  'utils/syncDatabase.ts',
  'utils/syncTransport.ts',
  'utils/syncEngine.ts',
  'utils/apiService.ts',
].map(file => path.join(repositoryRoot, file));
const compile = spawnSync(process.execPath, [
  compiler,
  '--pretty', 'false',
  '--module', 'commonjs',
  '--moduleResolution', 'node',
  '--target', 'ES2020',
  '--lib', 'ES2020,DOM,DOM.Iterable',
  '--skipLibCheck',
  '--esModuleInterop',
  '--outDir', buildDirectory,
  ...sourceFiles,
], { encoding: 'utf8' });

if (compile.status !== 0) {
  throw new Error(`TypeScript compilation failed:\n${compile.stdout}${compile.stderr}`);
}

const database = require(path.join(buildDirectory, 'utils', 'syncDatabase.js'));
const canonical = require(path.join(buildDirectory, 'utils', 'syncCanonical.js'));
const syncEngine = require(path.join(buildDirectory, 'utils', 'syncEngine.js'));
const apiService = require(path.join(buildDirectory, 'utils', 'apiService.js'));

test.after(() => fs.rmSync(buildDirectory, { recursive: true, force: true }));

class MemoryStorage {
  constructor(initial = {}) {
    this.values = new Map(Object.entries(initial));
  }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

const jsonResponse = (payload, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: status === 200 ? 'OK' : 'Error',
  json: async () => payload,
});

test.beforeEach(async () => {
  await database.resetSyncDatabaseForTests();
});

test('legacy LocalStorage migration is idempotent and preserves aliases and unknown fields', async () => {
  const storage = new MemoryStorage({
    vineApp_products: JSON.stringify([
      {
        ASIN: 'b012345678',
        last_update_time: 10,
        name: 'older',
        olderUnknown: { nested: true },
        nullableUnknown: null,
      },
      {
        ASIN: 'B012345678',
        last_update_time: 20,
        name: 'newer',
        newerUnknown: ['kept'],
      },
    ]),
  });
  const repository = await database.openProductRepository('https://example.test/data_operations', null);
  assert.equal(await database.migrateLegacyLocalStorage(repository.profile, storage), 1);
  assert.equal(storage.getItem('vineApp_products'), null);
  assert.equal(await database.migrateLegacyLocalStorage(repository.profile, storage), 0);

  const products = await repository.getProducts();
  assert.equal(products.length, 1);
  assert.equal(products[0].ASIN, 'B012345678');
  assert.equal(products[0].name, 'newer');
  assert.deepEqual(products[0].olderUnknown, { nested: true });
  assert.deepEqual(products[0].newerUnknown, ['kept']);
  assert.equal(products[0].nullableUnknown, null);
});

test('profiles are isolated and never expose the token in their identifier', async () => {
  const local = await database.openProductRepository('https://example.test/data_operations', null);
  await local.putProducts([{
    ASIN: 'B012345678',
    name: 'Local only',
    ordernumber: '1',
    date: '01/01/2025',
    etv: 1,
    teilwert: null,
    teilwert_v2: null,
    usageStatus: [],
  }]);
  const token = 'very-secret-token';
  const remote = await database.openProductRepository('https://example.test/data_operations', token);
  assert.notEqual(remote.profile.id, local.profile.id);
  assert.equal(remote.profile.id.includes(token), false);
  assert.equal(await database.cloneProfileProductsIfEmpty(local.profile.id, remote.profile.id), 1);
  assert.equal((await remote.getProducts()).length, 1);

  const secondRemote = await database.openProductRepository(
    'https://other-backend.test/data_operations',
    'different-private-account',
  );
  assert.equal(await database.cloneProfileProductsIfEmpty(local.profile.id, secondRemote.profile.id), 0);
  assert.equal((await secondRemote.getProducts()).length, 0);

  await local.clearLocalProducts();
  assert.equal(await database.cloneProfileProductsIfEmpty(remote.profile.id, local.profile.id), 0);
  assert.equal(await database.cloneProfileProductsIfEmpty(remote.profile.id, secondRemote.profile.id), 0);
  assert.equal((await local.getProducts()).length, 0);
  assert.equal((await secondRemote.getProducts()).length, 0);

  assert.equal(
    await database.getProfileId('https://EXAMPLE.test/API/', token),
    await database.getProfileId('https://example.test/API', token),
  );
  assert.notEqual(
    await database.getProfileId('https://example.test/API', token),
    await database.getProfileId('https://example.test/api', token),
  );
});

test('the first remote profile claims local seed data even when that remote is already populated', async () => {
  const local = await database.openProductRepository('https://example.test/data_operations', null);
  await local.putProducts([{ ASIN: 'B012345678', name: 'Private local seed' }]);
  const populatedRemote = await database.openProductRepository(
    'https://first-account.test/data_operations',
    'first-account-token',
  );
  await populatedRemote.putProducts([{ ASIN: 'B087654321', name: 'Existing remote cache' }]);
  assert.equal(
    await database.cloneProfileProductsIfEmpty(local.profile.id, populatedRemote.profile.id),
    0,
  );
  assert.equal(
    (await database.syncDatabase.profiles.get(local.profile.id)).localSeedClaimedBy,
    populatedRemote.profile.id,
  );

  const laterRemote = await database.openProductRepository(
    'https://second-account.test/data_operations',
    'second-account-token',
  );
  assert.equal(await database.cloneProfileProductsIfEmpty(local.profile.id, laterRemote.profile.id), 0);
  assert.equal((await laterRemote.getProducts()).length, 0);
});

test('legacy V1 profiles still open and synchronize when Web Crypto subtle is unavailable', async () => {
  const originalFetch = global.fetch;
  const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  const token = 'legacy-secret-token';
  const webCryptoProfileId = await database.getProfileId(
    'https://example.test/data_operations',
    token,
  );
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    writable: true,
    value: undefined,
  });
  const requests = [];
  global.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    requests.push(body.request);
    if (body.request === 'get_capabilities_v2') {
      return jsonResponse({
        status: 'error',
        message: 'Unknown request type: get_capabilities_v2',
      }, 400);
    }
    if (body.request === 'get_all') {
      return jsonResponse({ status: 'success', data: [] });
    }
    throw new Error(`Unexpected request ${body.request}`);
  };
  try {
    const firstId = await database.getProfileId('https://example.test/data_operations', token);
    const secondId = await database.getProfileId('https://EXAMPLE.test/data_operations/', token);
    assert.equal(firstId, secondId);
    assert.equal(firstId, webCryptoProfileId);
    assert.equal(firstId.includes(token), false);
    assert.equal(
      await canonical.sha256Hex('abc'),
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );

    const result = await apiService.apiGetAllProducts(
      'https://example.test/data_operations',
      token,
    );
    assert.equal(result.status, 'success', result.message);
    assert.equal(result.syncProtocol, 'v1');
    assert.deepEqual(result.data, []);
    assert.deepEqual(requests, ['get_capabilities_v2', 'get_all']);
  } finally {
    global.fetch = originalFetch;
    if (cryptoDescriptor) {
      Object.defineProperty(globalThis, 'crypto', cryptoDescriptor);
    } else {
      delete globalThis.crypto;
    }
  }
});

test('dataset hashing sorts entity identifiers ordinally by UTF-16 code units', async () => {
  const astral = '\u{10000}';
  const privateUse = '\uE000';
  const records = [
    { entity_type: 'storage_location', entity_id: privateUse, data: { value: 2 } },
    { entity_type: 'storage_location', entity_id: astral, data: { value: 1 } },
  ];
  const expectedOrder = [records[1], records[0]];
  const reverseOrder = [records[0], records[1]];
  const expectedHash = await canonical.sha256Hex(canonical.canonicalizeJson(expectedOrder));
  const reverseHash = await canonical.sha256Hex(canonical.canonicalizeJson(reverseOrder));
  assert.equal(await canonical.calculateDatasetHash(records), expectedHash);
  assert.notEqual(expectedHash, reverseHash);
});

test('outbox mutation IDs and payloads survive reopening after an uncertain send', async () => {
  const repository = await database.openProductRepository('https://example.test/data_operations', 'token');
  const product = {
    ASIN: 'B012345678',
    name: 'Offline edit',
    ordernumber: '1',
    date: '01/01/2025',
    etv: 1,
    teilwert: null,
    teilwert_v2: null,
    usageStatus: [],
    unknownField: 'preserved',
  };
  const queued = await repository.queueProduct(product);
  assert.ok(queued);
  await repository.markSending(queued);

  const reopened = await database.openProductRepository('https://example.test/data_operations', 'token');
  const records = await reopened.getOutbox();
  assert.equal(records.length, 1);
  assert.equal(records[0].mutationId, queued.mutationId);
  assert.equal(records[0].set.unknownField, 'preserved');
  assert.equal(records[0].state, 'sending');
  assert.equal(await reopened.queueProductsWithoutShadow(), 0);
  assert.equal((await reopened.getOutbox()).length, 1);
});

test('large independent outboxes use bounded batches instead of one HTTP request per product', async () => {
  const originalFetch = global.fetch;
  const repository = await database.openProductRepository('https://example.test/data_operations', 'token');
  await repository.updateSyncState({ protocol: 'v2', generationId: 'large-generation' });
  const total = 205;
  for (let index = 0; index < total; index += 1) {
    await repository.queueProduct({
      ASIN: `B${String(index).padStart(9, '0')}`,
      name: `Large local product ${index}`,
      unknownLargeField: { index },
    });
  }
  const batchSizes = [];
  let revision = 0;
  global.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.request, 'sync_v2_push');
    batchSizes.push(body.payload.mutations.length);
    const results = body.payload.mutations.map(mutation => {
      revision += 1;
      return {
        mutation_id: mutation.mutation_id,
        status: 'applied',
        revision,
        data: mutation.set,
      };
    });
    return jsonResponse({
      status: 'success', generation_id: 'large-generation', current_revision: revision, results,
    });
  };
  try {
    const pushed = await syncEngine.pushOutbox(
      repository,
      'https://example.test/data_operations',
      'token',
      {
        protocol_version: 2,
        sync_core_version: '2.0.0',
        canonicalization: 'jcs-rfc8785-v1',
        generation_id: 'large-generation',
        current_revision: 0,
        min_available_revision: 0,
        entity_types: ['product'],
        limits: { push_mutations: 100 },
      },
    );
    assert.equal(pushed, total);
    assert.deepEqual(batchSizes, [100, 100, 5]);
    assert.equal((await repository.getOutbox()).length, 0);
    assert.equal((await repository.getProducts()).length, total);
    assert.deepEqual(
      (await repository.getProducts()).find(product => product.ASIN === 'B000000204').unknownLargeField,
      { index: 204 },
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('pull overlays pending field removals without losing unrelated server fields', async () => {
  const repository = await database.openProductRepository('https://example.test/data_operations', 'token');
  await repository.replaceSnapshot([{
    entity_type: 'product',
    entity_id: 'B012345678',
    record_revision: 5,
    legacy_last_update_time: 10,
    data: {
      name: 'Product',
      ordernumber: '1',
      date: '01/01/2025',
      etv: 1,
      teilwert: null,
      teilwert_v2: null,
      usageStatus: [],
      salePrice: 25,
      unrelatedServerField: 'old',
    },
  }]);

  const local = (await repository.getProducts())[0];
  delete local.salePrice;
  const mutation = await repository.queueProduct(local);
  assert.ok(mutation);
  assert.deepEqual(mutation.unset, ['salePrice']);

  await repository.applyChange({
    revision: 6,
    entity_type: 'product',
    entity_id: 'B012345678',
    operation: 'upsert',
    set: { unrelatedServerField: 'new' },
    unset: [],
    data: {
      name: 'Product',
      ordernumber: '1',
      date: '01/01/2025',
      etv: 1,
      teilwert: null,
      teilwert_v2: null,
      usageStatus: [],
      salePrice: 25,
      unrelatedServerField: 'new',
    },
  });
  const overlaid = (await repository.getProducts())[0];
  assert.equal(overlaid.salePrice, undefined);
  assert.equal(overlaid.unrelatedServerField, 'new');
  assert.equal((await repository.getOutbox())[0].baseRevision, 5);
});

test('an incremental remote delete quarantines a pending edit without truncating the product', async () => {
  const repository = await database.openProductRepository('https://example.test/data_operations', 'token');
  const serverData = {
    name: 'Server product',
    ordernumber: 'ORDER-DELETE',
    date: '01/01/2025',
    etv: 9,
    teilwert: null,
    teilwert_v2: null,
    usageStatus: [],
    unknownField: { retained: true },
  };
  await repository.replaceSnapshot([{
    entity_type: 'product', entity_id: 'B012345678', record_revision: 6, data: serverData,
  }]);
  await repository.queueProduct({
    ...(await repository.getProducts())[0],
    name: 'Pending local edit',
  });

  await repository.applyChange({
    revision: 7,
    entity_type: 'product',
    entity_id: 'B012345678',
    operation: 'delete',
    record_revision: 7,
  });

  assert.equal((await repository.getOutbox()).length, 0);
  const [conflict] = await repository.listConflicts();
  assert.equal(conflict.serverRecord, null);
  assert.equal(conflict.serverRecordRevision, 7);
  assert.equal(conflict.localSet.name, 'Pending local edit');
  assert.equal(conflict.localSet.ordernumber, 'ORDER-DELETE');
  assert.deepEqual(conflict.localSet.unknownField, { retained: true });
  const [visible] = await repository.getProducts();
  assert.equal(visible.name, 'Pending local edit');
  assert.equal(visible.ordernumber, 'ORDER-DELETE');
  assert.deepEqual(visible.unknownField, { retained: true });
});

test('a push conflict against a deleted server record rebases a complete local restore on revision zero', async () => {
  const originalFetch = global.fetch;
  const repository = await database.openProductRepository('https://example.test/data_operations', 'token');
  const serverData = {
    name: 'Server product', ordernumber: 'RESTORE-1', date: '01/01/2025', etv: 4,
    teilwert: null, teilwert_v2: null, usageStatus: [], unknownField: { retained: true },
  };
  await repository.replaceSnapshot([{
    entity_type: 'product', entity_id: 'B012345678', record_revision: 6, data: serverData,
  }]);
  await repository.updateSyncState({ protocol: 'v2', generationId: 'generation-delete', cursor: 6 });
  await repository.queueProduct({
    ...(await repository.getProducts())[0],
    name: 'Local restore intent',
  });
  const capabilities = {
    protocol_version: 2,
    sync_core_version: '2.0.0',
    canonicalization: 'jcs-rfc8785-v1',
    generation_id: 'generation-delete',
    current_revision: 7,
    min_available_revision: 0,
    entity_types: ['product'],
    limits: { push_mutations: 100 },
  };
  global.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.request, 'sync_v2_push');
    const mutation = body.payload.mutations[0];
    return jsonResponse({
      status: 'success', generation_id: 'generation-delete', current_revision: 7,
      results: [{
        mutation_id: mutation.mutation_id,
        status: 'conflict',
        conflict: { fields: ['name'], server_revision: null, server_data: null },
      }],
    });
  };
  try {
    assert.equal(await syncEngine.pushOutbox(
      repository,
      'https://example.test/data_operations',
      'token',
      capabilities,
    ), 0);
    const [conflict] = await repository.listConflicts();
    assert.equal(conflict.serverRecordRevision, 0);
    assert.equal(conflict.serverRecord, null);
    assert.equal(conflict.localSet.name, 'Local restore intent');
    assert.equal(conflict.localSet.ordernumber, 'RESTORE-1');
    assert.deepEqual(conflict.localSet.unknownField, { retained: true });
    await repository.resolveConflict(conflict.id, 'local');
    const [restore] = await repository.getOutbox();
    assert.equal(restore.baseRevision, 0);
    assert.equal(restore.set.ordernumber, 'RESTORE-1');
  } finally {
    global.fetch = originalFetch;
  }
});

test('a stale tab sends only its user delta and cannot roll back a newer shared shadow', async () => {
  const repository = await database.openProductRepository('https://example.test/data_operations', 'token');
  const staleUiBase = {
    ASIN: 'B012345678', name: 'Product', etv: 1, sharedField: 'old', localField: 'before',
  };
  await repository.replaceSnapshot([{
    entity_type: 'product', entity_id: 'B012345678', record_revision: 8,
    data: { name: 'Product', etv: 1, sharedField: 'new', localField: 'before' },
  }]);

  const mutation = await repository.queueProduct(
    { ...staleUiBase, localField: 'after' },
    staleUiBase,
  );
  assert.ok(mutation);
  assert.equal(mutation.baseRevision, 8);
  assert.deepEqual(mutation.set, { localField: 'after' });
  const stored = (await repository.getProducts())[0];
  assert.equal(stored.sharedField, 'new');
  assert.equal(stored.localField, 'after');
});

test('a same-field stale-tab edit remains blocked and newest even when intent timestamps collide', async () => {
  const originalFetch = global.fetch;
  const originalNow = Date.now;
  const repository = await database.openProductRepository('https://example.test/data_operations', 'token');
  const serverProduct = {
    ASIN: 'B012345678',
    name: 'Server value',
    ordernumber: '1',
    date: '01/01/2025',
    etv: 1,
    teilwert: null,
    teilwert_v2: null,
    usageStatus: [],
    last_update_time: 1,
  };
  await repository.applyV1ServerProducts([serverProduct]);
  const staleUiBase = (await repository.getProducts())[0];
  const requests = [];
  Date.now = () => 1_700_000_000_000;
  global.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    requests.push(body.request);
    if (body.request === 'get_capabilities_v2') {
      return jsonResponse({
        status: 'error',
        message: 'Unknown request type: get_capabilities_v2',
      }, 400);
    }
    throw new Error(`Unexpected request ${body.request}`);
  };
  try {
    await repository.queueProduct(
      { ...staleUiBase, name: 'Newer shared edit', last_update_time: 2 },
      staleUiBase,
    );
    const response = await apiService.apiUpdateSingleProduct(
      'https://example.test/data_operations',
      'token',
      { ...staleUiBase, name: 'Newest stale-tab edit', last_update_time: 3 },
      staleUiBase,
    );
    assert.equal(response.status, 'success', response.message);
    assert.equal(response.skipped, 1);
    assert.deepEqual(requests, ['get_capabilities_v2']);

    const [pending] = await repository.getOutbox();
    const [conflict] = await repository.listConflicts();
    assert.deepEqual(conflict.fields, ['name']);
    assert.ok(conflict.createdAt > pending.createdAt);

    await repository.applyV1ServerProducts([serverProduct]);
    assert.equal((await repository.getProducts())[0].name, 'Newest stale-tab edit');
    assert.equal((await repository.getOutbox()).length, 1);
    assert.equal(await repository.countConflicts(), 1);
  } finally {
    Date.now = originalNow;
    global.fetch = originalFetch;
  }
});

test('open conflicts block only their entity and can preserve either local intent or server state', async () => {
  const repository = await database.openProductRepository('https://example.test/data_operations', 'token');
  const base = {
    name: 'Original', ordernumber: '1', date: '01/01/2025', etv: 1,
    teilwert: null, teilwert_v2: null, usageStatus: [], stableUnknown: 'kept',
  };
  await repository.replaceSnapshot([{
    entity_type: 'product', entity_id: 'B012345678', record_revision: 5, data: base,
  }, {
    entity_type: 'product', entity_id: 'B087654321', record_revision: 8, data: base,
  }]);

  const firstLocal = await repository.queueProduct({
    ...(await repository.getProducts()).find(product => product.ASIN === 'B012345678'),
    name: 'First local intent',
  });
  assert.ok(firstLocal);
  await repository.recordConflict(firstLocal, 6, ['name'], {
    ...base,
    name: 'Concurrent server value',
    serverOnlyAfterBase: { retained: true },
  });
  await repository.queueProduct({
    ...(await repository.getProducts()).find(product => product.ASIN === 'B012345678'),
    name: 'Latest local intent',
  });
  const otherEntity = await repository.queueProduct({
    ...(await repository.getProducts()).find(product => product.ASIN === 'B087654321'),
    name: 'Independent edit',
  });
  assert.ok(otherEntity);
  assert.deepEqual(
    (await repository.getSendableOutbox()).map(record => record.entityId),
    ['B087654321'],
  );

  const [localConflict] = await repository.listConflicts();
  await repository.resolveConflict(localConflict.id, 'local');
  assert.equal(await repository.countConflicts(), 0);
  const rebased = (await repository.getOutbox())
    .find(record => record.entityId === 'B012345678');
  assert.ok(rebased);
  assert.equal(rebased.baseRevision, 6);
  assert.deepEqual(rebased.set, { name: 'Latest local intent' });
  assert.deepEqual(rebased.unset, []);
  const locallyResolved = (await repository.getProducts())
    .find(product => product.ASIN === 'B012345678');
  assert.equal(locallyResolved.name, 'Latest local intent');
  assert.deepEqual(locallyResolved.serverOnlyAfterBase, { retained: true });

  const serverChoiceMutation = otherEntity;
  await repository.recordConflict(serverChoiceMutation, 9, ['name'], {
    ...base,
    name: 'Authoritative server value',
  });
  const [serverConflict] = await repository.listConflicts();
  await repository.resolveConflict(serverConflict.id, 'server');
  const serverResolved = (await repository.getProducts())
    .find(product => product.ASIN === 'B087654321');
  assert.equal(serverResolved.name, 'Authoritative server value');
  assert.equal((await repository.getOutbox())
    .some(record => record.entityId === 'B087654321'), false);
});

test('open conflicts track later pulls and generation snapshots without losing local intent', async () => {
  const repository = await database.openProductRepository('https://example.test/data_operations', 'token');
  const base = {
    name: 'Original', ordernumber: '1', date: '01/01/2025', etv: 1,
    teilwert: null, teilwert_v2: null, usageStatus: [], stableUnknown: 'base',
  };
  await repository.replaceSnapshot([{
    entity_type: 'product', entity_id: 'B012345678', record_revision: 5, data: base,
  }]);

  const firstLocal = await repository.queueProduct({
    ...(await repository.getProducts())[0],
    name: 'First local intent',
  });
  assert.ok(firstLocal);
  await repository.recordConflict(firstLocal, 6, ['name'], {
    ...base,
    name: 'Server revision 6',
    serverAtSix: true,
  });

  await repository.applyChange({
    revision: 7,
    entity_type: 'product',
    entity_id: 'B012345678',
    operation: 'upsert',
    set: { name: 'Server revision 7', serverAtSeven: { retained: true } },
    unset: [],
    data: {
      ...base,
      name: 'Server revision 7',
      serverAtSix: true,
      serverAtSeven: { retained: true },
    },
  });
  const afterPull = (await repository.getProducts())[0];
  assert.equal(afterPull.name, 'First local intent');
  assert.deepEqual(afterPull.serverAtSeven, { retained: true });
  assert.equal((await repository.listConflicts())[0].serverRecordRevision, 7);

  await repository.queueProduct({ ...afterPull, name: 'Latest local intent' });
  const nextGenerationServer = {
    ...base,
    name: 'New generation server value',
    newGenerationUnknown: ['must survive'],
  };
  await repository.replaceSnapshot([{
    entity_type: 'product',
    entity_id: 'B012345678',
    record_revision: 2,
    data: nextGenerationServer,
  }], true);

  const quarantined = await repository.listConflicts();
  assert.equal(quarantined.length, 2);
  assert.equal(quarantined.every(conflict => conflict.serverRecordRevision === 2), true);
  const afterSnapshot = (await repository.getProducts())[0];
  assert.equal(afterSnapshot.name, 'Latest local intent');
  assert.deepEqual(afterSnapshot.newGenerationUnknown, ['must survive']);

  await repository.resolveConflict(quarantined[0].id, 'local');
  assert.equal(await repository.countConflicts(), 0);
  const rebased = (await repository.getOutbox())
    .find(record => record.entityId === 'B012345678');
  assert.ok(rebased);
  assert.equal(rebased.baseRevision, 2);
  assert.deepEqual(rebased.set, { name: 'Latest local intent' });
  assert.deepEqual(rebased.unset, []);
  const resolved = (await repository.getProducts())[0];
  assert.equal(resolved.name, 'Latest local intent');
  assert.deepEqual(resolved.newGenerationUnknown, ['must survive']);
});

test('a repair snapshot quarantines an edit whose existing server record disappeared', async () => {
  const repository = await database.openProductRepository('https://example.test/data_operations', 'token');
  const serverData = {
    name: 'Existing server product',
    ordernumber: 'ORDER-1',
    date: '01/01/2025',
    etv: 12,
    teilwert: null,
    teilwert_v2: null,
    usageStatus: [],
    unknownField: { retained: true },
  };
  await repository.replaceSnapshot([{
    entity_type: 'product', entity_id: 'B012345678', record_revision: 6, data: serverData,
  }]);
  await repository.queueProduct({
    ...(await repository.getProducts())[0],
    name: 'Pending local edit',
  });

  await repository.replaceSnapshot([]);

  assert.equal((await repository.getOutbox()).length, 0);
  const [conflict] = await repository.listConflicts();
  assert.equal(conflict.serverRecord, null);
  assert.equal(conflict.serverRecordRevision, 0);
  assert.equal(conflict.localSet.name, 'Pending local edit');
  assert.equal(conflict.localSet.ordernumber, 'ORDER-1');
  assert.deepEqual(conflict.localSet.unknownField, { retained: true });
  const [visible] = await repository.getProducts();
  assert.equal(visible.name, 'Pending local edit');
  assert.equal(visible.ordernumber, 'ORDER-1');
  assert.deepEqual(visible.unknownField, { retained: true });
});

test('a later local edit remains newer than the delayed conflict response for an earlier push', async () => {
  const repository = await database.openProductRepository('https://example.test/data_operations', 'token');
  const base = { name: 'Base', etv: 1, stable: true };
  await repository.replaceSnapshot([{
    entity_type: 'product', entity_id: 'B012345678', record_revision: 3, data: base,
  }]);
  const first = await repository.queueProduct({
    ...(await repository.getProducts())[0],
    name: 'Earlier local edit',
  });
  assert.ok(first);
  first.createdAt = 100;
  await database.syncDatabase.outbox.update(first.id, { createdAt: 100 });

  const later = await repository.queueProduct({
    ...(await repository.getProducts())[0],
    name: 'Later local edit',
  });
  assert.ok(later);
  await database.syncDatabase.outbox.update(later.id, { createdAt: 200 });
  await repository.recordConflict(first, 4, ['name'], {
    ...base,
    name: 'Server conflict value',
    serverUnknown: 'retained',
  });

  await repository.applyChange({
    revision: 4,
    entity_type: 'product',
    entity_id: 'B012345678',
    operation: 'upsert',
    data: { ...base, name: 'Server conflict value', serverUnknown: 'retained' },
  });
  const visible = (await repository.getProducts())[0];
  assert.equal(visible.name, 'Later local edit');
  assert.equal(visible.serverUnknown, 'retained');

  const [conflict] = await repository.listConflicts();
  await repository.resolveConflict(conflict.id, 'local');
  const [rebased] = await repository.getOutbox();
  assert.equal(rebased.baseRevision, 4);
  assert.deepEqual(rebased.set, { name: 'Later local edit' });
});

test('danger-zone cleanup removes every local sync profile and queue', async () => {
  const local = await database.openProductRepository('https://example.test/data_operations', null);
  const remote = await database.openProductRepository('https://example.test/data_operations', 'token');
  await local.putProducts([{ ASIN: 'B012345678', name: 'Local' }]);
  await remote.queueProduct({ ASIN: 'B087654321', name: 'Remote' });
  await database.clearAllSyncData();
  assert.equal(await database.syncDatabase.profiles.count(), 0);
  assert.equal(await database.syncDatabase.products.count(), 0);
  assert.equal(await database.syncDatabase.outbox.count(), 0);
  assert.equal(await database.syncDatabase.shadows.count(), 0);
});

test('remote danger-zone delete drops pending writes without auto-reuploading the local recovery copy', async () => {
  const repository = await database.openProductRepository('https://example.test/data_operations', 'token');
  await repository.replaceSnapshot([{
    entity_type: 'product', entity_id: 'B012345678', record_revision: 7,
    data: { name: 'Local recovery copy', unknown: 'retained in IndexedDB' },
  }]);
  await repository.updateSyncState({
    protocol: 'v2', generationId: 'generation-before-delete', cursor: 7,
  });
  await repository.queueProduct({
    ...(await repository.getProducts())[0],
    name: 'Pending edit to discard with server delete',
  });
  await repository.acknowledgeRemoteDelete();

  assert.equal((await repository.getOutbox()).length, 0);
  assert.equal(await repository.countConflicts(), 0);
  assert.equal((await repository.getProducts())[0].unknown, 'retained in IndexedDB');
  assert.equal(await repository.queueProductsWithoutShadow(), 0);
  assert.equal((await repository.getSyncState()).snapshotRequired, true);
});

test('a V1 full read removes remote deletions but overlays unsent local edits', async () => {
  const repository = await database.openProductRepository('https://example.test/data_operations', 'token');
  const first = {
    ASIN: 'B012345678', name: 'First server value', ordernumber: '1', date: '01/01/2025',
    etv: 1, teilwert: null, teilwert_v2: null, usageStatus: [], last_update_time: 1,
  };
  const remotelyDeleted = {
    ASIN: 'B087654321', name: 'Will be deleted remotely', ordernumber: '2', date: '02/01/2025',
    etv: 2, teilwert: null, teilwert_v2: null, usageStatus: [], last_update_time: 1,
  };
  const deletedWithPendingEdit = {
    ASIN: 'B098765432', name: 'Deleted while edited', ordernumber: '3', date: '03/01/2025',
    etv: 3, teilwert: null, teilwert_v2: null, usageStatus: [],
    unknownField: { must: 'survive' }, last_update_time: 1,
  };
  await repository.applyV1ServerProducts([first, remotelyDeleted, deletedWithPendingEdit]);
  const initialProducts = await repository.getProducts();
  const localBase = initialProducts.find(product => product.ASIN === first.ASIN);
  await repository.queueProduct(
    { ...localBase, name: 'Unsent local edit', last_update_time: 2 },
    localBase,
  );
  const missingBase = initialProducts.find(product => product.ASIN === deletedWithPendingEdit.ASIN);
  await repository.queueProduct(
    { ...missingBase, name: 'Unsent edit on remote deletion', last_update_time: 2 },
    missingBase,
  );

  const merged = await repository.applyV1ServerProducts([first]);
  assert.equal(merged.length, 2);
  assert.equal(merged.find(product => product.ASIN === first.ASIN).name, 'Unsent local edit');
  assert.equal(merged.some(product => product.ASIN === remotelyDeleted.ASIN), false);
  const preservedMissing = merged.find(product => product.ASIN === deletedWithPendingEdit.ASIN);
  assert.equal(preservedMissing.name, 'Unsent edit on remote deletion');
  assert.equal(preservedMissing.ordernumber, '3');
  assert.deepEqual(preservedMissing.unknownField, { must: 'survive' });
  assert.equal((await repository.getOutbox()).length, 2);
  const deletionShadow = await database.syncDatabase.shadows.get([
    repository.profile.id, 'product', remotelyDeleted.ASIN,
  ]);
  assert.equal(deletionShadow.deleted, 1);
});

test('a V1 acknowledgement removes only mutations included in its request snapshot', async () => {
  const originalFetch = global.fetch;
  const repository = await database.openProductRepository('https://example.test/data_operations', 'token');
  const serverProduct = {
    ASIN: 'B012345678', name: 'Server value', ordernumber: '1', date: '01/01/2025',
    etv: 1, teilwert: null, teilwert_v2: null, usageStatus: [], last_update_time: 1,
  };
  await repository.applyV1ServerProducts([serverProduct]);
  const base = (await repository.getProducts())[0];
  let updateRequests = 0;
  global.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    if (body.request === 'get_capabilities_v2') {
      return jsonResponse({
        status: 'error',
        message: 'Unknown request type: get_capabilities_v2',
      }, 400);
    }
    if (body.request === 'update_asin') {
      updateRequests += 1;
      const sentValue = JSON.parse(body.payload[0].value);
      assert.equal(sentValue.name, 'Sent edit');
      const current = (await repository.getProducts())[0];
      await repository.queueProduct(
        { ...current, ordernumber: 'edit-during-request', last_update_time: 3 },
        current,
      );
      await repository.queueProduct(
        { ...base, name: 'Conflicting edit during request', last_update_time: 4 },
        base,
      );
      return jsonResponse({ status: 'success', inserted: 0, updated: 1, skipped: 0 });
    }
    throw new Error(`Unexpected request ${body.request}`);
  };
  try {
    const response = await apiService.apiUpdateSingleProduct(
      'https://example.test/data_operations',
      'token',
      { ...base, name: 'Sent edit', last_update_time: 2 },
      base,
    );
    assert.equal(response.status, 'success', response.message);
    assert.equal(updateRequests, 1);
    const current = (await repository.getProducts())[0];
    assert.equal(current.name, 'Conflicting edit during request');
    assert.equal(current.ordernumber, 'edit-during-request');
    const remaining = await repository.getOutbox();
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].set.ordernumber, 'edit-during-request');
    const [conflict] = await repository.listConflicts();
    assert.deepEqual(conflict.fields, ['name']);
    assert.equal(conflict.serverRecord.name, 'Sent edit');
    const shadow = await database.syncDatabase.shadows.get([
      repository.profile.id, 'product', serverProduct.ASIN,
    ]);
    assert.equal(shadow.value.name, 'Sent edit');
  } finally {
    global.fetch = originalFetch;
  }
});

test('a late V1 acknowledgement cannot roll back a newer acknowledged request', async () => {
  const repository = await database.openProductRepository('https://example.test/data_operations', 'token');
  const serverProduct = {
    ASIN: 'B012345678', name: 'Server value', ordernumber: '1', date: '01/01/2025',
    etv: 1, teilwert: null, teilwert_v2: null, usageStatus: [], last_update_time: 1,
  };
  await repository.applyV1ServerProducts([serverProduct]);
  const base = (await repository.getProducts())[0];
  await repository.queueProduct({ ...base, name: 'Older request', last_update_time: 2 }, base);
  const olderRequest = await repository.prepareV1Upload([serverProduct.ASIN]);
  const newerBase = (await repository.getProducts())[0];
  await repository.queueProduct(
    { ...newerBase, name: 'Newer request', last_update_time: 3 },
    newerBase,
  );
  const newerRequest = await repository.prepareV1Upload([serverProduct.ASIN]);

  await repository.acknowledgeV1Products(newerRequest.products, newerRequest.mutationIds);
  await repository.acknowledgeV1Products(olderRequest.products, olderRequest.mutationIds);

  assert.equal((await repository.getOutbox()).length, 0);
  assert.equal((await repository.getProducts())[0].name, 'Newer request');
  const shadow = await database.syncDatabase.shadows.get([
    repository.profile.id, 'product', serverProduct.ASIN,
  ]);
  assert.equal(shadow.value.name, 'Newer request');
});

test('capability fallback accepts only the explicit legacy 400 response, never HTTP 404', async () => {
  const originalFetch = global.fetch;
  const requests = [];
  global.fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return jsonResponse({ status: 'error', message: 'Not Found' }, 404);
  };
  try {
    const response = await apiService.apiGetAllProducts('https://example.test/wrong-path', 'token');
    assert.equal(response.status, 'error');
    assert.match(response.message, /Not Found/);
    assert.deepEqual(requests.map(request => request.request), ['get_capabilities_v2']);
  } finally {
    global.fetch = originalFetch;
  }
});

test('an expired multi-page snapshot is restarted once with a fresh session', async () => {
  const originalFetch = global.fetch;
  const generationId = 'snapshot-generation';
  const backendData = { name: 'Snapshot product', unknown: 'kept' };
  const datasetHash = await canonical.calculateDatasetHash([{
    entity_type: 'product',
    entity_id: 'B012345678',
    data: backendData,
  }]);
  let snapshotCalls = 0;
  global.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    if (body.request === 'get_capabilities_v2') {
      return jsonResponse({
        status: 'success',
        protocol_version: 2,
        sync_core_version: '2.0.0',
        canonicalization: 'jcs-rfc8785-v1',
        generation_id: generationId,
        current_revision: 1,
        min_available_revision: 0,
        entity_types: ['product'],
        limits: { push_mutations: 100, pull_changes: 100, snapshot_records: 1 },
        dataset_hash: datasetHash,
      });
    }
    if (body.request === 'sync_v2_snapshot') {
      snapshotCalls += 1;
      if (snapshotCalls === 1) {
        assert.equal(body.payload.session_id, undefined);
        return jsonResponse({
          status: 'success',
          session_id: 'expired-session',
          generation_id: generationId,
          snapshot_revision: 1,
          records: [{
            entity_type: 'product',
            entity_id: 'B012345678',
            record_revision: 1,
            data: backendData,
          }],
          next_offset: 1,
          has_more: true,
          dataset_hash: datasetHash,
        });
      }
      if (snapshotCalls === 2) {
        assert.equal(body.payload.session_id, 'expired-session');
        return jsonResponse({
          status: 'error',
          code: 'snapshot_expired',
          message: 'Snapshot expired.',
          snapshot_required: true,
        }, 409);
      }
      assert.equal(body.payload.session_id, undefined);
      return jsonResponse({
        status: 'success',
        session_id: 'fresh-session',
        generation_id: generationId,
        snapshot_revision: 1,
        records: [{
          entity_type: 'product',
          entity_id: 'B012345678',
          record_revision: 1,
          data: backendData,
        }],
        next_offset: 1,
        has_more: false,
        dataset_hash: datasetHash,
      });
    }
    if (body.request === 'sync_v2_pull') {
      return jsonResponse({
        status: 'success',
        generation_id: generationId,
        changes: [],
        next_cursor: 1,
        current_revision: 1,
        min_available_revision: 0,
        has_more: false,
        dataset_hash: datasetHash,
      });
    }
    throw new Error(`Unexpected request ${body.request}`);
  };
  try {
    const result = await apiService.apiGetAllProducts('https://example.test/data_operations', 'token');
    assert.equal(result.status, 'success');
    assert.equal(result.data[0].unknown, 'kept');
    assert.equal(snapshotCalls, 3);
  } finally {
    global.fetch = originalFetch;
  }
});

test('a snapshot retry that crosses generations quarantines the old pending outbox', async () => {
  const originalFetch = global.fetch;
  const repository = await database.openProductRepository('https://example.test/data_operations', 'token');
  const oldData = { name: 'Old server value', stable: true };
  const removedOldData = {
    name: 'Old product removed in new generation',
    ordernumber: 'OLD-2',
    etv: 7,
    unknownField: { must: 'survive quarantine' },
  };
  const newData = { name: 'New generation value', restored: true };
  await repository.replaceSnapshot([{
    entity_type: 'product', entity_id: 'B012345678', record_revision: 3, data: oldData,
  }, {
    entity_type: 'product', entity_id: 'B087654321', record_revision: 2, data: removedOldData,
  }]);
  await repository.updateSyncState({
    protocol: 'v2', generationId: 'generation-old', cursor: 3, snapshotRequired: true,
  });
  const retainedProduct = (await repository.getProducts())
    .find(product => product.ASIN === 'B012345678');
  await repository.queueProduct({
    ...retainedProduct,
    name: 'Unsynced old-generation edit',
  });
  const removedProduct = (await repository.getProducts())
    .find(product => product.ASIN === 'B087654321');
  await repository.queueProduct({
    ...removedProduct,
    name: 'Unsynced edit on removed product',
  });
  const oldHash = await canonical.calculateDatasetHash([{
    entity_type: 'product', entity_id: 'B012345678', data: oldData,
  }, {
    entity_type: 'product', entity_id: 'B087654321', data: removedOldData,
  }]);
  const newHash = await canonical.calculateDatasetHash([{
    entity_type: 'product', entity_id: 'B012345678', data: newData,
  }]);
  let snapshotCalls = 0;
  global.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    if (body.request === 'get_capabilities_v2') {
      return jsonResponse({
        status: 'success', protocol_version: 2, sync_core_version: '2.0.0',
        canonicalization: 'jcs-rfc8785-v1', generation_id: 'generation-old',
        current_revision: 3, min_available_revision: 0, entity_types: ['product'],
        limits: { push_mutations: 100, pull_changes: 100, snapshot_records: 1 },
        dataset_hash: oldHash,
      });
    }
    if (body.request === 'sync_v2_snapshot') {
      snapshotCalls += 1;
      if (snapshotCalls === 1) {
        assert.equal(body.payload.generation_id, 'generation-old');
        return jsonResponse({
          status: 'success', session_id: 'expired-old-session', generation_id: 'generation-old',
          snapshot_revision: 3,
          records: [{
            entity_type: 'product', entity_id: 'B012345678', record_revision: 3, data: oldData,
          }],
          next_offset: 1, has_more: true, dataset_hash: oldHash,
        });
      }
      if (snapshotCalls === 2) {
        return jsonResponse({
          status: 'error', code: 'snapshot_expired', message: 'Snapshot expired.',
          snapshot_required: true,
        }, 409);
      }
      assert.equal(body.payload.generation_id, undefined);
      assert.equal(body.payload.session_id, undefined);
      return jsonResponse({
        status: 'success', session_id: 'fresh-new-session', generation_id: 'generation-new',
        snapshot_revision: 9,
        records: [{
          entity_type: 'product', entity_id: 'B012345678', record_revision: 9, data: newData,
        }],
        next_offset: 1, has_more: false, dataset_hash: newHash,
      });
    }
    if (body.request === 'sync_v2_pull') {
      assert.equal(body.payload.generation_id, 'generation-new');
      return jsonResponse({
        status: 'success', generation_id: 'generation-new', changes: [], next_cursor: 9,
        current_revision: 9, min_available_revision: 0, has_more: false, dataset_hash: newHash,
      });
    }
    throw new Error(`Unexpected request ${body.request}`);
  };
  try {
    const result = await apiService.apiGetAllProducts('https://example.test/data_operations', 'token');
    assert.equal(result.status, 'success', result.message);
    assert.equal(snapshotCalls, 3);
    assert.equal((await repository.getSyncState()).generationId, 'generation-new');
    assert.equal((await repository.getOutbox()).length, 0);
    const conflicts = await repository.listConflicts();
    assert.equal(conflicts.length, 2);
    const retainedConflict = conflicts.find(conflict => conflict.entityId === 'B012345678');
    assert.equal(retainedConflict.localSet.name, 'Unsynced old-generation edit');
    assert.equal(retainedConflict.serverRecord.name, 'New generation value');
    const removedConflict = conflicts.find(conflict => conflict.entityId === 'B087654321');
    assert.equal(removedConflict.localSet.name, 'Unsynced edit on removed product');
    assert.equal(removedConflict.localSet.ordernumber, 'OLD-2');
    assert.deepEqual(removedConflict.localSet.unknownField, { must: 'survive quarantine' });
    assert.equal(removedConflict.serverRecord, null);
    const products = await repository.getProducts();
    assert.equal(
      products.find(product => product.ASIN === 'B012345678').name,
      'Unsynced old-generation edit',
    );
    const removedVisible = products.find(product => product.ASIN === 'B087654321');
    assert.equal(removedVisible.ordernumber, 'OLD-2');
    assert.deepEqual(removedVisible.unknownField, { must: 'survive quarantine' });
  } finally {
    global.fetch = originalFetch;
  }
});

test('duplicate entity keys abort a snapshot before replacing the last verified state', async () => {
  const originalFetch = global.fetch;
  const repository = await database.openProductRepository('https://example.test/data_operations', 'token');
  const verifiedData = { name: 'Last verified value', retained: true };
  await repository.replaceSnapshot([{
    entity_type: 'product', entity_id: 'B012345678', record_revision: 4, data: verifiedData,
  }]);
  await repository.updateSyncState({
    protocol: 'v2', generationId: 'generation-old', cursor: 4,
  });
  let snapshotCalls = 0;
  global.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    if (body.request === 'get_capabilities_v2') {
      return jsonResponse({
        status: 'success', protocol_version: 2, sync_core_version: '2.0.0',
        canonicalization: 'jcs-rfc8785-v1', generation_id: 'generation-new',
        current_revision: 1, min_available_revision: 0, entity_types: ['product'],
        limits: { push_mutations: 100, pull_changes: 100, snapshot_records: 100 },
      });
    }
    if (body.request === 'sync_v2_snapshot') {
      snapshotCalls += 1;
      return jsonResponse({
        status: 'success', session_id: 'duplicate-session', generation_id: 'generation-new',
        snapshot_revision: 1,
        records: [{
          entity_type: 'product', entity_id: 'B012345678', record_revision: 1,
          data: { name: 'First duplicate' },
        }, {
          entity_type: 'product', entity_id: 'B012345678', record_revision: 1,
          data: { name: 'Second duplicate' },
        }],
        next_offset: 2, has_more: false, dataset_hash: 'not-used',
      });
    }
    throw new Error(`Unexpected request ${body.request}`);
  };
  try {
    const result = await apiService.apiGetAllProducts('https://example.test/data_operations', 'token');
    assert.equal(result.status, 'error');
    assert.match(result.message, /mehrfach/);
    assert.equal(snapshotCalls, 1);
    assert.deepEqual((await repository.getProducts())[0].retained, true);
    const shadow = await database.syncDatabase.shadows.get([
      repository.profile.id, 'product', 'B012345678',
    ]);
    assert.deepEqual(shadow.value, verifiedData);
    assert.equal((await repository.getSyncState()).generationId, 'generation-old');
  } finally {
    global.fetch = originalFetch;
  }
});

test('a corrupt initial snapshot is replaced by one fresh verified download', async () => {
  const originalFetch = global.fetch;
  const generationId = 'snapshot-hash-generation';
  const goodData = { name: 'Verified snapshot' };
  const hash = await canonical.calculateDatasetHash([{
    entity_type: 'product', entity_id: 'B012345678', data: goodData,
  }]);
  let snapshots = 0;
  global.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    if (body.request === 'get_capabilities_v2') return jsonResponse({
      status: 'success', protocol_version: 2, sync_core_version: '2.0.0',
      canonicalization: 'jcs-rfc8785-v1', generation_id: generationId,
      current_revision: 1, min_available_revision: 0, entity_types: ['product'],
      limits: { push_mutations: 100, pull_changes: 100, snapshot_records: 100 },
      dataset_hash: hash,
    });
    if (body.request === 'sync_v2_snapshot') {
      snapshots += 1;
      return jsonResponse({
        status: 'success', session_id: `snapshot-${snapshots}`, generation_id: generationId,
        snapshot_revision: 1,
        records: [{
          entity_type: 'product', entity_id: 'B012345678', record_revision: 1,
          data: snapshots === 1 ? { name: 'Corrupt snapshot' } : goodData,
        }],
        next_offset: 1, has_more: false, dataset_hash: hash,
      });
    }
    if (body.request === 'sync_v2_pull') return jsonResponse({
      status: 'success', generation_id: generationId, changes: [], next_cursor: 1,
      current_revision: 1, min_available_revision: 0, has_more: false, dataset_hash: hash,
    });
    throw new Error(`Unexpected request ${body.request}`);
  };
  try {
    const result = await apiService.apiGetAllProducts('https://example.test/data_operations', 'token');
    assert.equal(result.status, 'success', result.message);
    assert.equal(result.data[0].name, 'Verified snapshot');
    assert.equal(snapshots, 2);
    assert.match(result.message, /Hash-Abweichung/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('two corrupt snapshots fail without replacing the last verified local state', async () => {
  const originalFetch = global.fetch;
  const repository = await database.openProductRepository('https://example.test/data_operations', 'token');
  const verifiedLocal = { name: 'Last verified local shadow', unknown: 'must survive' };
  await repository.replaceSnapshot([{
    entity_type: 'product', entity_id: 'B012345678', record_revision: 4, data: verifiedLocal,
  }]);
  await repository.updateSyncState({
    protocol: 'v2', generationId: 'old-generation', cursor: 4, minAvailableRevision: 0,
  });
  const advertisedData = { name: 'Advertised but never delivered intact' };
  const advertisedHash = await canonical.calculateDatasetHash([{
    entity_type: 'product', entity_id: 'B012345678', data: advertisedData,
  }]);
  let snapshots = 0;
  global.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    if (body.request === 'get_capabilities_v2') return jsonResponse({
      status: 'success', protocol_version: 2, sync_core_version: '2.0.0',
      canonicalization: 'jcs-rfc8785-v1', generation_id: 'new-generation',
      current_revision: 1, min_available_revision: 0, entity_types: ['product'],
      limits: { push_mutations: 100, pull_changes: 100, snapshot_records: 100 },
      dataset_hash: advertisedHash,
    });
    if (body.request === 'sync_v2_snapshot') {
      snapshots += 1;
      return jsonResponse({
        status: 'success', session_id: `corrupt-${snapshots}`, generation_id: 'new-generation',
        snapshot_revision: 1,
        records: [{
          entity_type: 'product', entity_id: 'B012345678', record_revision: 1,
          data: { name: `Corrupt delivery ${snapshots}` },
        }],
        next_offset: 1, has_more: false, dataset_hash: advertisedHash,
      });
    }
    throw new Error(`Unexpected request ${body.request}`);
  };
  try {
    const result = await apiService.apiGetAllProducts('https://example.test/data_operations', 'token');
    assert.equal(result.status, 'error');
    assert.match(result.message, /Integritätsprüfung/);
    assert.equal(snapshots, 2);
    assert.deepEqual((await repository.getProducts())[0].unknown, 'must survive');
    const shadow = await database.syncDatabase.shadows.get([
      repository.profile.id, 'product', 'B012345678',
    ]);
    assert.deepEqual(shadow.value, verifiedLocal);
    assert.equal(shadow.recordRevision, 4);
  } finally {
    global.fetch = originalFetch;
  }
});

test('generation mismatch refreshes capabilities and replaces state from a new snapshot', async () => {
  const originalFetch = global.fetch;
  const repository = await database.openProductRepository('https://example.test/data_operations', 'token');
  await repository.replaceSnapshot([{
    entity_type: 'product',
    entity_id: 'B012345678',
    record_revision: 1,
    data: { name: 'Old generation' },
  }]);
  await repository.updateSyncState({
    protocol: 'v2',
    generationId: 'generation-old',
    cursor: 1,
    minAvailableRevision: 0,
  });
  const staleMutation = await repository.queueProduct({
    ...(await repository.getProducts())[0],
    name: 'Unsynced edit from old generation',
  });
  assert.ok(staleMutation);
  await repository.markSending(staleMutation);
  const newData = { name: 'New generation', restored: true };
  const newHash = await canonical.calculateDatasetHash([{
    entity_type: 'product',
    entity_id: 'B012345678',
    data: newData,
  }]);
  let capabilityCalls = 0;
  let oldPulls = 0;
  global.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    if (body.request === 'get_capabilities_v2') {
      capabilityCalls += 1;
      const isRefresh = capabilityCalls > 1;
      return jsonResponse({
        status: 'success',
        protocol_version: 2,
        sync_core_version: '2.0.0',
        canonicalization: 'jcs-rfc8785-v1',
        generation_id: isRefresh ? 'generation-new' : 'generation-old',
        current_revision: isRefresh ? 4 : 1,
        min_available_revision: 0,
        entity_types: ['product'],
        limits: { push_mutations: 100, pull_changes: 100, snapshot_records: 100 },
        dataset_hash: isRefresh ? newHash : null,
      });
    }
    if (body.request === 'sync_v2_pull' && body.payload.generation_id === 'generation-old') {
      oldPulls += 1;
      return jsonResponse({
        status: 'error',
        code: 'generation_mismatch',
        message: 'Generation changed.',
        snapshot_required: true,
      }, 409);
    }
    if (body.request === 'sync_v2_snapshot') {
      assert.equal(body.payload.generation_id, undefined);
      return jsonResponse({
        status: 'success',
        session_id: 'new-generation-snapshot',
        generation_id: 'generation-new',
        snapshot_revision: 4,
        records: [{
          entity_type: 'product',
          entity_id: 'B012345678',
          record_revision: 4,
          data: newData,
        }],
        next_offset: 1,
        has_more: false,
        dataset_hash: newHash,
      });
    }
    if (body.request === 'sync_v2_pull') {
      assert.equal(body.payload.generation_id, 'generation-new');
      return jsonResponse({
        status: 'success',
        generation_id: 'generation-new',
        changes: [],
        next_cursor: 4,
        current_revision: 4,
        min_available_revision: 0,
        has_more: false,
        dataset_hash: newHash,
      });
    }
    throw new Error(`Unexpected request ${body.request}`);
  };
  try {
    const result = await apiService.apiGetAllProducts('https://example.test/data_operations', 'token');
    assert.equal(result.status, 'success');
    assert.equal(result.data[0].restored, true);
    assert.match(result.message, /Snapshot/);
    assert.equal(capabilityCalls, 2);
    assert.equal(oldPulls, 1);
    assert.equal((await repository.getSyncState()).generationId, 'generation-new');
    assert.equal((await repository.getOutbox()).length, 0);
    const [quarantined] = await repository.listConflicts();
    assert.equal(quarantined.localSet.name, 'Unsynced edit from old generation');
    assert.equal(quarantined.serverRecordRevision, 4);
    assert.equal(quarantined.serverRecord.restored, true);
  } finally {
    global.fetch = originalFetch;
  }
});

test('a successful pull from a different generation is rejected before applying its changes', async () => {
  const originalFetch = global.fetch;
  const repository = await database.openProductRepository('https://example.test/data_operations', 'token');
  await repository.replaceSnapshot([{
    entity_type: 'product', entity_id: 'B012345678', record_revision: 1,
    data: { name: 'Old generation' },
  }]);
  await repository.updateSyncState({
    protocol: 'v2', generationId: 'generation-old', cursor: 1,
  });
  const repairedData = { name: 'Verified new generation', repaired: true };
  const repairedHash = await canonical.calculateDatasetHash([{
    entity_type: 'product', entity_id: 'B012345678', data: repairedData,
  }]);
  let capabilityCalls = 0;
  let stalePulls = 0;
  let snapshots = 0;
  global.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    if (body.request === 'get_capabilities_v2') {
      capabilityCalls += 1;
      const refreshed = capabilityCalls > 1;
      return jsonResponse({
        status: 'success', protocol_version: 2, sync_core_version: '2.0.0',
        canonicalization: 'jcs-rfc8785-v1',
        generation_id: refreshed ? 'generation-new' : 'generation-old',
        current_revision: refreshed ? 4 : 1,
        min_available_revision: 0,
        entity_types: ['product'],
        limits: { push_mutations: 100, pull_changes: 100, snapshot_records: 100 },
        dataset_hash: refreshed ? repairedHash : null,
      });
    }
    if (body.request === 'sync_v2_pull' && body.payload.generation_id === 'generation-old') {
      stalePulls += 1;
      return jsonResponse({
        status: 'success', generation_id: 'generation-new',
        changes: [{
          revision: 4, entity_type: 'product', entity_id: 'B012345678',
          operation: 'upsert', data: { name: 'Must never be applied', malicious: true },
        }],
        next_cursor: 4, current_revision: 4, min_available_revision: 0,
        has_more: false, dataset_hash: null,
      });
    }
    if (body.request === 'sync_v2_snapshot') {
      snapshots += 1;
      assert.equal(body.payload.generation_id, undefined);
      return jsonResponse({
        status: 'success', session_id: 'generation-repair', generation_id: 'generation-new',
        snapshot_revision: 4,
        records: [{
          entity_type: 'product', entity_id: 'B012345678', record_revision: 4,
          data: repairedData,
        }],
        next_offset: 1, has_more: false, dataset_hash: repairedHash,
      });
    }
    if (body.request === 'sync_v2_pull') {
      assert.equal(body.payload.generation_id, 'generation-new');
      return jsonResponse({
        status: 'success', generation_id: 'generation-new', changes: [], next_cursor: 4,
        current_revision: 4, min_available_revision: 0, has_more: false,
        dataset_hash: repairedHash,
      });
    }
    throw new Error(`Unexpected request ${body.request}`);
  };
  try {
    const result = await apiService.apiGetAllProducts('https://example.test/data_operations', 'token');
    assert.equal(result.status, 'success', result.message);
    assert.equal(result.data[0].name, 'Verified new generation');
    assert.equal(result.data[0].malicious, undefined);
    assert.equal(capabilityCalls, 2);
    assert.equal(stalePulls, 1);
    assert.equal(snapshots, 1);
  } finally {
    global.fetch = originalFetch;
  }
});

test('cursor-expired HTTP 409 triggers a full snapshot without falling back to V1', async () => {
  const originalFetch = global.fetch;
  const repository = await database.openProductRepository('https://example.test/data_operations', 'token');
  await repository.updateSyncState({ protocol: 'v2', generationId: 'generation-1', cursor: 5 });
  const data = { name: 'Recovered cursor' };
  const hash = await canonical.calculateDatasetHash([{
    entity_type: 'product', entity_id: 'B012345678', data,
  }]);
  let firstPull = true;
  let snapshotCalls = 0;
  global.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    if (body.request === 'get_capabilities_v2') {
      return jsonResponse({
        status: 'success', protocol_version: 2, sync_core_version: '2.0.0',
        canonicalization: 'jcs-rfc8785-v1', generation_id: 'generation-1',
        current_revision: 10, min_available_revision: 0, entity_types: ['product'],
        limits: { push_mutations: 100, pull_changes: 100, snapshot_records: 100 },
        dataset_hash: hash,
      });
    }
    if (body.request === 'sync_v2_pull' && firstPull) {
      firstPull = false;
      return jsonResponse({
        status: 'error', code: 'cursor_expired', message: 'Cursor expired.',
        snapshot_required: true,
      }, 409);
    }
    if (body.request === 'sync_v2_snapshot') {
      snapshotCalls += 1;
      return jsonResponse({
        status: 'success', session_id: 'cursor-repair', generation_id: 'generation-1',
        snapshot_revision: 10,
        records: [{ entity_type: 'product', entity_id: 'B012345678', record_revision: 10, data }],
        next_offset: 1, has_more: false, dataset_hash: hash,
      });
    }
    if (body.request === 'sync_v2_pull') {
      return jsonResponse({
        status: 'success', generation_id: 'generation-1', changes: [], next_cursor: 10,
        current_revision: 10, min_available_revision: 0, has_more: false, dataset_hash: hash,
      });
    }
    throw new Error(`Unexpected request ${body.request}`);
  };
  try {
    const result = await apiService.apiGetAllProducts('https://example.test/data_operations', 'token');
    assert.equal(result.status, 'success');
    assert.equal(result.syncProtocol, 'v2');
    assert.equal(result.data[0].name, 'Recovered cursor');
    assert.equal(snapshotCalls, 1);
  } finally {
    global.fetch = originalFetch;
  }
});

test('an edit made during an in-flight push becomes a separate mutation rebased on its ack', async () => {
  const originalFetch = global.fetch;
  const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  let browserLockTail = Promise.resolve();
  let activeBrowserLocks = 0;
  let maximumActiveBrowserLocks = 0;
  const browserLockNames = [];
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      locks: {
        request(name, options, callback) {
          assert.deepEqual(options, { mode: 'exclusive' });
          browserLockNames.push(name);
          const operation = browserLockTail.then(async () => {
            activeBrowserLocks += 1;
            maximumActiveBrowserLocks = Math.max(maximumActiveBrowserLocks, activeBrowserLocks);
            try {
              return await callback();
            } finally {
              activeBrowserLocks -= 1;
            }
          });
          browserLockTail = operation.then(() => undefined, () => undefined);
          return operation;
        },
      },
    },
  });
  const generationId = 'generation-inflight';
  const repository = await database.openProductRepository('https://example.test/data_operations', 'token');
  let revision = 1;
  let backendData = {
    name: 'Original', ordernumber: '1', date: '01/01/2025', etv: 1,
    teilwert: null, teilwert_v2: null, usageStatus: [], unknown: 'preserved',
  };
  await repository.replaceSnapshot([{
    entity_type: 'product', entity_id: 'B012345678', record_revision: revision,
    legacy_last_update_time: 1, data: backendData,
  }]);
  await repository.updateSyncState({
    protocol: 'v2', generationId, cursor: revision, minAvailableRevision: 0,
  });

  let notifyFirstPush;
  const firstPushStarted = new Promise(resolve => { notifyFirstPush = resolve; });
  let releaseFirstPush;
  const firstPushGate = new Promise(resolve => { releaseFirstPush = resolve; });
  let notifySecondCapability;
  const secondCapabilitySeen = new Promise(resolve => { notifySecondCapability = resolve; });
  let capabilityCalls = 0;
  const pushedMutations = [];
  const currentHash = () => canonical.calculateDatasetHash([{
    entity_type: 'product', entity_id: 'B012345678', data: backendData,
  }]);

  global.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    if (body.request === 'get_capabilities_v2') {
      capabilityCalls += 1;
      if (capabilityCalls === 2) notifySecondCapability();
      return jsonResponse({
        status: 'success', protocol_version: 2, sync_core_version: '2.0.0',
        canonicalization: 'jcs-rfc8785-v1', generation_id: generationId,
        current_revision: revision, min_available_revision: 0, entity_types: ['product'],
        limits: { push_mutations: 100, pull_changes: 100, snapshot_records: 100 },
        dataset_hash: await currentHash(),
      });
    }
    if (body.request === 'sync_v2_pull') {
      return jsonResponse({
        status: 'success', generation_id: generationId, changes: [],
        next_cursor: revision, current_revision: revision, min_available_revision: 0,
        has_more: false, dataset_hash: await currentHash(),
      });
    }
    if (body.request === 'sync_v2_push') {
      const mutation = structuredClone(body.payload.mutations[0]);
      pushedMutations.push(mutation);
      if (pushedMutations.length === 1) {
        notifyFirstPush();
        await firstPushGate;
      }
      backendData = database.applyPatch(backendData, mutation.set || {}, mutation.unset || []);
      revision += 1;
      return jsonResponse({
        status: 'success', generation_id: generationId, current_revision: revision,
        results: [{
          mutation_id: mutation.mutation_id, status: 'applied', revision, data: backendData,
        }],
      });
    }
    throw new Error(`Unexpected request ${body.request}`);
  };

  try {
    const product = { ...(await repository.getProducts())[0] };
    const firstSave = apiService.apiUpdateSingleProduct(
      'https://example.test/data_operations', 'token', { ...product, name: 'First edit' },
    );
    await firstPushStarted;
    const secondSave = apiService.apiUpdateSingleProduct(
      'https://example.test/data_operations', 'token', { ...product, name: 'Second edit' },
    );
    await secondCapabilitySeen;
    const inFlightOutbox = await repository.getOutbox();
    assert.equal(inFlightOutbox.length, 2);
    assert.equal(inFlightOutbox[0].state, 'sending');
    assert.equal(inFlightOutbox[0].set.name, 'First edit');
    assert.equal(inFlightOutbox[1].state, 'pending');
    assert.equal(inFlightOutbox[1].set.name, 'Second edit');

    releaseFirstPush();
    const [firstResult, secondResult] = await Promise.all([firstSave, secondSave]);
    assert.equal(firstResult.status, 'success');
    assert.equal(secondResult.status, 'success');
    assert.equal(pushedMutations.length, 2);
    assert.notEqual(pushedMutations[0].mutation_id, pushedMutations[1].mutation_id);
    assert.equal(pushedMutations[0].base_revision, 1);
    assert.equal(pushedMutations[0].set.name, 'First edit');
    assert.equal(pushedMutations[1].base_revision, 2);
    assert.deepEqual(pushedMutations[1].set, { name: 'Second edit' });
    assert.equal(backendData.name, 'Second edit');
    assert.equal(backendData.unknown, 'preserved');
    assert.equal((await repository.getOutbox()).length, 0);
    assert.equal(maximumActiveBrowserLocks, 1);
    assert.equal(browserLockNames.length, 2);
    assert.equal(browserLockNames[0], browserLockNames[1]);
    assert.match(browserLockNames[0], /^vine-product-manager-sync:remote:/);
  } finally {
    releaseFirstPush();
    global.fetch = originalFetch;
    if (originalNavigatorDescriptor) {
      Object.defineProperty(globalThis, 'navigator', originalNavigatorDescriptor);
    } else {
      delete globalThis.navigator;
    }
  }
});

test('a dataset hash mismatch performs one full repair snapshot and informs the caller', async () => {
  const originalFetch = global.fetch;
  const generationId = 'generation-hash';
  const repository = await database.openProductRepository('https://example.test/data_operations', 'token');
  const data = { name: 'Hash checked', unknown: { nested: true } };
  const correctHash = await canonical.calculateDatasetHash([{
    entity_type: 'product', entity_id: 'B012345678', data,
  }]);
  await repository.replaceSnapshot([{
    entity_type: 'product', entity_id: 'B012345678', record_revision: 3, data,
  }]);
  await repository.updateSyncState({ protocol: 'v2', generationId, cursor: 3 });
  let snapshots = 0;
  global.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    if (body.request === 'get_capabilities_v2') {
      return jsonResponse({
        status: 'success', protocol_version: 2, sync_core_version: '2.0.0',
        canonicalization: 'jcs-rfc8785-v1', generation_id: generationId,
        current_revision: 3, min_available_revision: 0, entity_types: ['product'],
        limits: { push_mutations: 100, pull_changes: 100, snapshot_records: 100 },
        dataset_hash: correctHash,
      });
    }
    if (body.request === 'sync_v2_pull') {
      return jsonResponse({
        status: 'success', generation_id: generationId, changes: [], next_cursor: 3,
        current_revision: 3, min_available_revision: 0, has_more: false,
        dataset_hash: '0'.repeat(64),
      });
    }
    if (body.request === 'sync_v2_snapshot') {
      snapshots += 1;
      return jsonResponse({
        status: 'success', session_id: 'hash-repair', generation_id: generationId,
        snapshot_revision: 3,
        records: [{ entity_type: 'product', entity_id: 'B012345678', record_revision: 3, data }],
        next_offset: 1, has_more: false, dataset_hash: correctHash,
      });
    }
    throw new Error(`Unexpected request ${body.request}`);
  };
  try {
    const result = await apiService.apiGetAllProducts('https://example.test/data_operations', 'token');
    assert.equal(result.status, 'success', result.message);
    assert.equal(snapshots, 1);
    assert.match(result.message, /Hash-Abweichung/);
    assert.deepEqual(result.data[0].unknown, { nested: true });
  } finally {
    global.fetch = originalFetch;
  }
});

test('V2 snapshot, incremental push, hash check and conflict storage use the agreed wire contract', async () => {
  const originalFetch = global.fetch;
  const requests = [];
  const generationId = 'generation-1';
  let revision = 5;
  let backendData = {
    name: 'Server product',
    ordernumber: 'ORDER-1',
    date: '01/02/2025',
    etv: 12.5,
    teilwert: null,
    teilwert_v2: null,
    usageStatus: [],
    unknownServerField: { retained: true },
  };
  let conflictNextPush = false;

  const currentHash = async () => canonical.calculateDatasetHash([{
    entity_type: 'product',
    entity_id: 'B012345678',
    data: backendData,
  }]);

  global.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    requests.push(body);
    let payload;
    if (body.request === 'get_capabilities_v2') {
      payload = {
        status: 'success',
        protocol_version: 2,
        sync_core_version: '2.0.0',
        canonicalization: 'jcs-rfc8785-v1',
        generation_id: generationId,
        current_revision: revision,
        min_available_revision: 0,
        entity_types: ['product'],
        limits: { push_mutations: 100, pull_changes: 100, snapshot_records: 100 },
        dataset_hash: await currentHash(),
      };
    } else if (body.request === 'sync_v2_snapshot') {
      payload = {
        status: 'success',
        session_id: 'snapshot-session',
        generation_id: generationId,
        snapshot_revision: revision,
        records: [{
          entity_type: 'product',
          entity_id: 'B012345678',
          record_revision: revision,
          legacy_last_update_time: 50,
          data: backendData,
        }],
        next_offset: 1,
        has_more: false,
        dataset_hash: await currentHash(),
      };
    } else if (body.request === 'sync_v2_pull') {
      payload = {
        status: 'success',
        generation_id: generationId,
        changes: [],
        next_cursor: revision,
        current_revision: revision,
        min_available_revision: 0,
        has_more: false,
        dataset_hash: await currentHash(),
      };
    } else if (body.request === 'sync_v2_push') {
      const mutation = body.payload.mutations[0];
      if (conflictNextPush) {
        conflictNextPush = false;
        payload = {
          status: 'success',
          generation_id: generationId,
          current_revision: revision,
          results: [{
            mutation_id: mutation.mutation_id,
            status: 'conflict',
            conflict: {
              fields: {
                salePrice: {
                  reason: 'changed_since_base',
                  server_revision: revision,
                },
              },
              server_revision: revision,
              server_data: backendData,
            },
          }],
        };
      } else {
        backendData = database.applyPatch(backendData, mutation.set || {}, mutation.unset || []);
        revision += 1;
        payload = {
          status: 'success',
          generation_id: generationId,
          current_revision: revision,
          results: [{
            mutation_id: mutation.mutation_id,
            status: 'applied',
            revision,
            data: backendData,
          }],
        };
      }
    } else {
      throw new Error(`Unexpected request ${body.request}`);
    }
    return { ok: true, status: 200, statusText: 'OK', json: async () => payload };
  };

  try {
    const loaded = await apiService.apiGetAllProducts('https://example.test/data_operations', 'token');
    assert.equal(loaded.status, 'success');
    assert.equal(loaded.syncProtocol, 'v2');
    assert.deepEqual(loaded.data[0].unknownServerField, { retained: true });

    const update = { ...loaded.data[0], name: 'Locally changed' };
    const updateResponse = await apiService.apiUpdateSingleProduct(
      'https://example.test/data_operations',
      'token',
      update,
    );
    assert.equal(updateResponse.status, 'success');
    const firstPush = requests.find(request => request.request === 'sync_v2_push');
    assert.ok(
      requests.findIndex(request => request.request === 'sync_v2_snapshot')
        < requests.findIndex(request => request.request === 'sync_v2_push'),
      'initial snapshot must finish before the first push',
    );
    assert.equal(firstPush.payload.mutations[0].base_revision, 5);
    assert.deepEqual(firstPush.payload.mutations[0].set, { name: 'Locally changed' });
    assert.equal(backendData.unknownServerField.retained, true);

    conflictNextPush = true;
    const conflictResponse = await apiService.apiUpdateSingleProduct(
      'https://example.test/data_operations',
      'token',
      { ...update, salePrice: 99 },
    );
    assert.equal(conflictResponse.status, 'success');
    assert.equal(conflictResponse.conflicts, 1);
    const repository = await database.openProductRepository('https://example.test/data_operations', 'token');
    assert.equal(await repository.countConflicts(), 1);
    const storedConflict = await database.syncDatabase.conflicts
      .where('profileId')
      .equals(repository.profile.id)
      .first();
    assert.deepEqual(storedConflict.fields, ['salePrice']);
    assert.equal((await repository.getProducts())[0].salePrice, 99);
  } finally {
    global.fetch = originalFetch;
  }
});
