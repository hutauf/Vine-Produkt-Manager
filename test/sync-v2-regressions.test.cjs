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

const buildDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'vine-sync-v2-regressions-'));
const compiler = path.join(repositoryRoot, 'node_modules', 'typescript', 'bin', 'tsc');
const sourceFiles = [
  'types.ts',
  'utils/dateUtils.ts',
  'utils/productCompatibility.ts',
  'utils/syncTypes.ts',
  'utils/syncCanonical.ts',
  'utils/syncProductCompatibility.ts',
  'utils/syncDatabase.ts',
  'utils/syncTransport.ts',
  'utils/syncEngine.ts',
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

test.after(() => fs.rmSync(buildDirectory, { recursive: true, force: true }));
test.beforeEach(async () => database.resetSyncDatabaseForTests());

const product = (ASIN, name, last_update_time, extra = {}) => ({
  ASIN,
  name,
  ordernumber: `ORDER-${ASIN.slice(-2)}`,
  date: '01/01/2025',
  etv: 10,
  teilwert: null,
  teilwert_v2: null,
  usageStatus: [],
  last_update_time,
  ...extra,
});

const jsonResponse = payload => ({
  ok: true,
  status: 200,
  statusText: 'OK',
  json: async () => payload,
});

test('V2 mutations keep canonical and legacy compatibility fields in sync', async () => {
  const repository = await database.openProductRepository('https://example.test/sync', 'token');
  const asin = 'B000000071';
  const rawServerValue = {
    name: 'Compatibility fields',
    ordernumber: 'ORDER-71',
    date: '01/01/2025',
    etv: 10,
    teilwert: null,
    teilwert_v2: null,
    usageStatus: ['verkauft'],
    verkauft: true,
    myTeilwert: 5,
    myteilwert: 5,
  };
  await repository.replaceSnapshot([{
    entity_type: 'product',
    entity_id: asin,
    record_revision: 4,
    legacy_last_update_time: 10,
    data: rawServerValue,
  }]);

  const base = (await repository.getProducts())[0];
  const edited = {
    ...base,
    usageStatus: [],
    myTeilwert: 9,
    // These stale fields model the value left behind by the old V2 writer.
    verkauft: true,
    myteilwert: 5,
  };
  const mutation = await repository.queueProduct(edited, base);

  assert.ok(mutation);
  assert.deepEqual(mutation.set.usageStatus, []);
  assert.equal(mutation.set.verkauft, false);
  assert.equal(mutation.set.myTeilwert, 9);
  assert.equal(mutation.set.myteilwert, 9);
  assert.equal(mutation.unset.includes('verkauft'), false);
  assert.equal(mutation.unset.includes('myteilwert'), false);

  const [local] = await repository.getProducts();
  assert.deepEqual(local.usageStatus, []);
  assert.equal(local.verkauft, false);
  assert.equal(local.myTeilwert, 9);
  assert.equal(local.myteilwert, 9);

  const shadow = await database.syncDatabase.shadows.get([
    repository.profile.id,
    'product',
    asin,
  ]);
  assert.deepEqual(shadow.value, rawServerValue);
});

test('an unattempted A-to-B mutation disappears when the user reverts to A', async () => {
  const repository = await database.openProductRepository('https://example.test/sync', 'token');
  const server = product('B000000001', 'A', 10, { unknownServerField: 'kept' });
  const { ASIN, last_update_time, ...serverValue } = server;
  await repository.replaceSnapshot([{
    entity_type: 'product', entity_id: ASIN, record_revision: 5,
    legacy_last_update_time: last_update_time, data: serverValue,
  }]);

  const base = (await repository.getProducts())[0];
  assert.ok(await repository.queueProduct({ ...base, name: 'B' }));
  assert.equal(await repository.queueProduct({ ...base, name: 'A' }), null);
  assert.equal((await repository.getOutbox()).length, 0);
  assert.equal((await repository.getProducts())[0].name, 'A');
});

test('an uncertain mutation stays immutable and a real compensating delta survives every rebase', async () => {
  const repository = await database.openProductRepository('https://example.test/sync', 'token');
  const server = product('B000000002', 'A', 10, { unknownServerField: 'kept' });
  const { ASIN, last_update_time, ...serverValue } = server;
  await repository.replaceSnapshot([{
    entity_type: 'product', entity_id: ASIN, record_revision: 5,
    legacy_last_update_time: last_update_time, data: serverValue,
  }]);
  const base = (await repository.getProducts())[0];
  const first = await repository.queueProduct({ ...base, name: 'B' });
  const claimed = await repository.markSending(first);
  assert.ok(claimed);
  const compensation = await repository.queueProduct({ ...base, name: 'A' });
  assert.ok(compensation);

  // Force a timestamp tie to prove the primary-key tie breaker and the
  // invariant that compensation is durably ordered after its predecessor.
  await database.syncDatabase.outbox.update(first.id, { createdAt: 100 });
  await database.syncDatabase.outbox.update(compensation.id, { createdAt: 100 });
  await repository.rebasePendingProductMutations(ASIN);
  let chain = await repository.getOutbox();
  assert.equal(chain.length, 2);
  assert.equal(chain[0].mutationId, first.mutationId);
  assert.equal(chain[0].state, 'sending');
  assert.equal(chain[0].attempts, 1);
  assert.deepEqual(chain[0].set, { name: 'B' });
  assert.equal(chain[1].createdAt, 101);
  assert.deepEqual(chain[1].set, { name: 'A' });
  assert.notDeepEqual(chain[1].set, {});

  // The first request may or may not have committed when a snapshot arrives.
  // Both server views must retain the final local intent A.
  await repository.replaceSnapshot([{
    entity_type: 'product', entity_id: ASIN, record_revision: 6,
    legacy_last_update_time: 11, data: { ...serverValue, name: 'B' },
  }]);
  await repository.rebasePendingProductMutations(ASIN);
  chain = await repository.getOutbox();
  assert.equal(chain[0].mutationId, first.mutationId);
  assert.equal(chain[0].baseRevision, 5);
  assert.deepEqual(chain[0].set, { name: 'B' });
  assert.equal(chain[1].baseRevision, 6);
  assert.deepEqual(chain[1].set, { name: 'A' });
  assert.equal((await repository.getProducts())[0].name, 'A');
});

test('a stale queue candidate cannot be claimed after a newer local edit replaced it', async () => {
  const repository = await database.openProductRepository('https://example.test/sync', 'token');
  const server = product('B000000003', 'A', 1);
  const { ASIN, last_update_time, ...serverValue } = server;
  await repository.replaceSnapshot([{
    entity_type: 'product', entity_id: ASIN, record_revision: 1,
    legacy_last_update_time: last_update_time, data: serverValue,
  }]);
  const base = (await repository.getProducts())[0];
  const staleCandidate = await repository.queueProduct({ ...base, name: 'B' });
  const replacement = await repository.queueProduct({ ...base, name: 'C' });
  assert.equal(await repository.markSending(staleCandidate), null);
  const [durable] = await repository.getOutbox();
  assert.equal(durable.mutationId, replacement.mutationId);
  assert.equal(durable.state, 'pending');
  assert.deepEqual(durable.set, { name: 'C' });
});

test('the first V1 read preserves local-only and newer legacy seed data exactly once', async () => {
  const repository = await database.openProductRepository('https://example.test/sync', 'token');
  await repository.putProducts([
    product('B000000011', 'stale local', 10),
    product('B000000012', 'newer local', 30, { localUnknown: true }),
    product('B000000013', 'local only', 5),
  ]);
  const serverProducts = [
    product('B000000011', 'newer server', 20),
    product('B000000012', 'older server', 20, { serverUnknown: 'preserved' }),
  ];

  let merged = await repository.applyV1ServerProducts(serverProducts);
  assert.equal(merged.find(entry => entry.ASIN === 'B000000011').name, 'newer server');
  const newerLocal = merged.find(entry => entry.ASIN === 'B000000012');
  assert.equal(newerLocal.name, 'newer local');
  assert.equal(newerLocal.serverUnknown, 'preserved');
  assert.equal(merged.find(entry => entry.ASIN === 'B000000013').name, 'local only');
  assert.deepEqual(
    (await repository.getOutbox()).map(record => record.entityId).sort(),
    ['B000000012', 'B000000013'],
  );

  // A second read no longer makes a bootstrap timestamp decision; the durable
  // outbox, rather than timestamps, is what preserves the two local intents.
  merged = await repository.applyV1ServerProducts(serverProducts);
  assert.equal(merged.find(entry => entry.ASIN === 'B000000012').name, 'newer local');
  assert.equal(merged.find(entry => entry.ASIN === 'B000000013').name, 'local only');
  assert.equal((await repository.getOutbox()).length, 2);
  assert.notEqual((await repository.getSyncState()).lastSyncAt, null);
});

test('a V1 read and acknowledgement cannot erase compensation behind an in-flight write', async () => {
  const repository = await database.openProductRepository('https://example.test/sync', 'token');
  const server = product('B000000021', 'A', 1);
  await repository.applyV1ServerProducts([server]);
  const base = (await repository.getProducts())[0];
  await repository.queueProduct({ ...base, name: 'B', last_update_time: 2 });
  const frozen = await repository.prepareV1Upload([base.ASIN]);
  assert.equal(frozen.products[0].name, 'B');
  assert.equal(frozen.mutationIds.length, 1);
  await repository.queueProduct({ ...base, name: 'A', last_update_time: 3 });

  await repository.applyV1ServerProducts([server]);
  let chain = await repository.getOutbox();
  assert.equal(chain.length, 2);
  assert.equal(chain[0].state, 'sending');
  assert.deepEqual(chain[1].set, { name: 'A' });

  await repository.acknowledgeV1Products(frozen.products, frozen.mutationIds);
  chain = await repository.getOutbox();
  assert.equal(chain.length, 1);
  assert.deepEqual(chain[0].set, { name: 'A' });
  assert.equal((await repository.getProducts())[0].name, 'A');
});

test('the first V2 snapshot uploads only local-only or newer seed intent, never stale cache', async () => {
  const originalFetch = global.fetch;
  const repository = await database.openProductRepository('https://example.test/sync', 'token');
  await repository.putProducts([
    product('B000000031', 'stale local', 10),
    product('B000000032', 'newer local', 30, { localUnknown: true }),
    product('B000000033', 'local only', 5),
  ]);

  const generationId = 'bootstrap-generation';
  let revision = 10;
  const backend = new Map([
    ['B000000031', { recordRevision: 8, timestamp: 20, value: {
      ...product('B000000031', 'newer server', 20), serverUnknown: 'stale-wins',
    } }],
    ['B000000032', { recordRevision: 9, timestamp: 20, value: {
      ...product('B000000032', 'older server', 20), serverUnknown: 'must survive',
    } }],
  ]);
  for (const entry of backend.values()) {
    delete entry.value.ASIN;
    delete entry.value.last_update_time;
  }
  const backendHash = () => canonical.calculateDatasetHash([...backend].map(([entity_id, entry]) => ({
    entity_type: 'product', entity_id, data: entry.value,
  })));
  const pushed = [];
  global.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    if (body.request === 'sync_v2_snapshot') {
      return jsonResponse({
        status: 'success', session_id: 'bootstrap-session', generation_id: generationId,
        snapshot_revision: revision,
        records: [...backend].map(([entity_id, entry]) => ({
          entity_type: 'product', entity_id, record_revision: entry.recordRevision,
          legacy_last_update_time: entry.timestamp, data: entry.value,
        })),
        next_offset: null, has_more: false, dataset_hash: await backendHash(),
      });
    }
    if (body.request === 'sync_v2_push') {
      const results = [];
      for (const mutation of body.payload.mutations) {
        pushed.push(structuredClone(mutation));
        const current = backend.get(mutation.entity_id);
        const value = database.applyPatch(current?.value ?? {}, mutation.set ?? {}, mutation.unset ?? []);
        revision += 1;
        backend.set(mutation.entity_id, {
          recordRevision: revision,
          timestamp: current?.timestamp ?? 0,
          value,
        });
        results.push({
          mutation_id: mutation.mutation_id,
          status: 'applied',
          revision,
          data: value,
        });
      }
      return jsonResponse({
        status: 'success', generation_id: generationId,
        current_revision: revision, results, dataset_hash: await backendHash(),
      });
    }
    if (body.request === 'sync_v2_pull') {
      return jsonResponse({
        status: 'success', generation_id: generationId, changes: [],
        next_cursor: revision, current_revision: revision, min_available_revision: 0,
        has_more: false, dataset_hash: await backendHash(),
      });
    }
    throw new Error(`Unexpected request ${body.request}`);
  };

  const capabilities = {
    protocol_version: 2,
    sync_core_version: '2.0.0',
    canonicalization: 'jcs-rfc8785-v1',
    generation_id: generationId,
    current_revision: revision,
    min_available_revision: 0,
    entity_types: ['product'],
    limits: { push_mutations: 100, pull_changes: 100, snapshot_records: 100 },
    dataset_hash: await backendHash(),
  };
  try {
    const result = await syncEngine.runV2Sync(
      repository,
      'https://example.test/sync',
      'token',
      capabilities,
    );
    assert.equal(result.pushed, 2);
    assert.deepEqual(pushed.map(mutation => mutation.entity_id).sort(), [
      'B000000032',
      'B000000033',
    ]);
    assert.equal(pushed.find(mutation => mutation.entity_id === 'B000000032').base_revision, 9);
    assert.equal(pushed.find(mutation => mutation.entity_id === 'B000000033').base_revision, 0);
    const byAsin = new Map(result.products.map(entry => [entry.ASIN, entry]));
    assert.equal(byAsin.get('B000000031').name, 'newer server');
    assert.equal(byAsin.get('B000000032').name, 'newer local');
    assert.equal(byAsin.get('B000000032').serverUnknown, 'must survive');
    assert.equal(byAsin.get('B000000033').name, 'local only');
  } finally {
    global.fetch = originalFetch;
  }
});

test('V2 snapshot and pull normalize product compatibility without changing raw hash shadows', async () => {
  const repository = await database.openProductRepository('https://example.test/sync', 'token');
  const asin = 'B000000041';
  const raw = {
    name: 'Legacy shape',
    ordernumber: 'ORDER-41',
    date: '1.2.2025',
    etv: '7,5',
    teilwert: '4.25',
    myteilwert: '3,5',
    verkauft: true,
    unknownFutureField: { nested: ['kept'] },
  };
  await repository.replaceSnapshot([{
    entity_type: 'product', entity_id: asin, record_revision: 3,
    legacy_last_update_time: 10, data: raw,
  }]);
  let [visible] = await repository.getProducts();
  assert.equal(visible.date, '01/02/2025');
  assert.equal(visible.etv, 7.5);
  assert.equal(visible.teilwert, 4.25);
  assert.equal(visible.myTeilwert, 3.5);
  assert.deepEqual(visible.usageStatus, ['verkauft']);
  assert.deepEqual(visible.unknownFutureField, { nested: ['kept'] });
  let shadow = await database.syncDatabase.shadows.get([repository.profile.id, 'product', asin]);
  assert.deepEqual(shadow.value, raw);
  assert.equal(Object.prototype.hasOwnProperty.call(shadow.value, 'usageStatus'), false);
  assert.equal(
    await canonical.calculateDatasetHash(await repository.getCanonicalShadowRecords()),
    await canonical.calculateDatasetHash([{ entity_type: 'product', entity_id: asin, data: raw }]),
  );

  await repository.applyChange({
    revision: 4,
    record_revision: 4,
    entity_type: 'product',
    entity_id: asin,
    operation: 'patch',
    set: { storniert: true, anotherUnknown: 42 },
    unset: [],
    legacy_last_update_time: 11,
  });
  [visible] = await repository.getProducts();
  assert.deepEqual(visible.usageStatus.sort(), ['storniert', 'verkauft']);
  assert.equal(visible.anotherUnknown, 42);
  assert.deepEqual(visible.unknownFutureField, { nested: ['kept'] });
  shadow = await database.syncDatabase.shadows.get([repository.profile.id, 'product', asin]);
  assert.equal(Object.prototype.hasOwnProperty.call(shadow.value, 'usageStatus'), false);
  assert.equal(shadow.value.storniert, true);
});

test('a stale acknowledgement removes its durable mutation without rolling back a newer shadow', async () => {
  const repository = await database.openProductRepository('https://example.test/sync', 'token');
  const asin = 'B000000051';
  const base = product(asin, 'revision 5', 5);
  const { ASIN, last_update_time, ...baseValue } = base;
  await repository.replaceSnapshot([{
    entity_type: 'product', entity_id: ASIN, record_revision: 5,
    legacy_last_update_time: last_update_time, data: baseValue,
  }]);
  const mutation = await repository.queueProduct({ ...(await repository.getProducts())[0], name: 'local' });
  const claimed = await repository.markSending(mutation);
  await repository.applyChange({
    revision: 7,
    record_revision: 7,
    entity_type: 'product',
    entity_id: asin,
    operation: 'upsert',
    data: { ...baseValue, name: 'revision 7' },
    legacy_last_update_time: 7,
  });
  await repository.acknowledgeMutation(claimed, 6, { ...baseValue, name: 'stale revision 6' });
  const shadow = await database.syncDatabase.shadows.get([repository.profile.id, 'product', asin]);
  assert.equal(shadow.recordRevision, 7);
  assert.equal(shadow.value.name, 'revision 7');
  assert.equal((await repository.getProducts())[0].name, 'revision 7');
  assert.equal((await repository.getOutbox()).length, 0);
});

test('generation reset quarantine remains one conflict with no auto-requeued outbox', async () => {
  const repository = await database.openProductRepository('https://example.test/sync', 'token');
  const asin = 'B000000061';
  await repository.replaceSnapshot([{
    entity_type: 'product', entity_id: asin, record_revision: 4,
    data: { name: 'old generation' },
  }]);
  await repository.updateSyncState({ generationId: 'old-generation', cursor: 4, protocol: 'v2' });
  await repository.queueProduct({ ...(await repository.getProducts())[0], name: 'local intent' });
  await repository.replaceSnapshot([], true);
  await repository.queueProductsWithoutShadow();
  await repository.queueProductsWithoutShadow();
  assert.equal((await repository.listConflicts()).length, 1);
  assert.equal((await repository.getOutbox()).length, 0);
});
