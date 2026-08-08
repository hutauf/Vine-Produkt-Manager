const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
require('fake-indexeddb/auto');

const repositoryRoot = path.resolve(__dirname, '..');
process.env.NODE_PATH = [
  path.join(repositoryRoot, 'node_modules'),
  process.env.NODE_PATH,
].filter(Boolean).join(path.delimiter);
require('node:module').Module._initPaths();
const buildDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'vine-date-contract-'));
const compiler = path.join(repositoryRoot, 'node_modules', 'typescript', 'bin', 'tsc');
const compile = spawnSync(process.execPath, [
  compiler,
  '--pretty', 'false',
  '--module', 'commonjs',
  '--moduleResolution', 'node',
  '--target', 'ES2020',
  '--skipLibCheck',
  '--outDir', buildDirectory,
  path.join(repositoryRoot, 'types.ts'),
  path.join(repositoryRoot, 'utils', 'dateUtils.ts'),
  path.join(repositoryRoot, 'utils', 'productCompatibility.ts'),
  path.join(repositoryRoot, 'utils', 'apiService.ts'),
], { encoding: 'utf8' });

if (compile.status !== 0) {
  throw new Error(`TypeScript compilation failed:\n${compile.stdout}${compile.stderr}`);
}

const dateUtilsPath = path.join(buildDirectory, 'utils', 'dateUtils.js');
const dateUtils = require(dateUtilsPath);
const apiService = require(path.join(buildDirectory, 'utils', 'apiService.js'));

test.after(() => fs.rmSync(buildDirectory, { recursive: true, force: true }));

test('order dates normalize without timestamps or a 1970 fallback', () => {
  assert.equal(dateUtils.normalizeDateString('2025-03-17T00:00:00.000Z'), '17/03/2025');
  assert.equal(dateUtils.normalizeDateString('2025-03-17T23:59:59-11:00'), '17/03/2025');
  assert.equal(dateUtils.normalizeDateString('1.3.2025'), '01/03/2025');
  assert.equal(dateUtils.normalizeDateString('29/02/2024'), '29/02/2024');
  assert.equal(dateUtils.normalizeDateString('29/02/2023'), '');
  assert.equal(dateUtils.normalizeDateString(undefined), '');
  assert.equal(dateUtils.normalizeDateString(''), '');
});

test('normalization is byte-identical in different process time zones', () => {
  const script = `
    const d = require(${JSON.stringify(dateUtilsPath)});
    process.stdout.write(d.normalizeDateString('2025-03-17T00:00:00.000Z'));
  `;
  for (const timezone of ['UTC', 'Europe/Berlin', 'America/Los_Angeles', 'Pacific/Kiritimati']) {
    const result = spawnSync(process.execPath, ['-e', script], {
      encoding: 'utf8',
      env: { ...process.env, TZ: timezone },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '17/03/2025', timezone);
  }
});

test('API serializer contains no fabricated epoch order date', () => {
  const apiSource = fs.readFileSync(path.join(repositoryRoot, 'utils', 'apiService.ts'), 'utf8');
  assert.doesNotMatch(apiSource, /01\/01\/1970/);
  assert.doesNotMatch(apiSource, /toISOString\s*\(/);
  assert.match(apiSource, /normalizedOrderDate && \{ date: normalizedOrderDate \}/);
});

test('invalid raw order dates are removed from updates and ASIN cleanup payloads', () => {
  const serialized = apiService.productToApiValue({
    ASIN: 'B012345678',
    name: 'Invalid date',
    ordernumber: '1',
    date: '31/02/2025',
    etv: 1,
    teilwert: null,
    usageStatus: [],
  });
  assert.equal(Object.hasOwn(serialized, 'date'), false);

  const canonicalized = apiService.canonicalizeApiProductEntries([{
    ASIN: 'b012345678',
    last_update_time: 1,
    value: JSON.stringify({ name: 'Invalid date', date: 'not-a-date', unknown: true }),
  }]);
  const corrected = JSON.parse(canonicalized.corrections[0].value);
  assert.equal(Object.hasOwn(corrected, 'date'), false);
  assert.equal(corrected.unknown, true);
});

test('startup merges raw ASIN case variants and preserves unknown fields', async () => {
  const requests = [];
  const originalFetch = global.fetch;
  global.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    requests.push(body);
    if (body.request === 'get_capabilities_v2') {
      return {
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: async () => ({ status: 'error', message: 'Unknown request type: get_capabilities_v2' }),
      };
    }
    const payload = body.request === 'get_all'
      ? {
          status: 'success',
          data: [
            {
              ASIN: 'b012345678',
              last_update_time: 10,
              value: JSON.stringify({
                name: 'older',
                ordernumber: '1',
                date: '2025-05-04T23:00:00.000Z',
                etv: 10,
                teilwert: null,
                usageStatus: [],
                olderUnknown: true,
              }),
            },
            {
              ASIN: 'B012345678',
              last_update_time: 20,
              value: JSON.stringify({
                name: 'newer',
                newerUnknown: true,
              }),
            },
          ],
        }
      : { status: 'success', inserted: 0, updated: 1, skipped: 0 };
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => payload,
    };
  };

  try {
    const response = await apiService.apiGetAllProducts(
      'https://example.test/data_operations',
      'test-token',
    );
    assert.equal(response.status, 'success');
    assert.equal(response.data.length, 1);
    assert.equal(response.data[0].ASIN, 'B012345678');
    assert.equal(response.data[0].name, 'newer');
    assert.equal(response.data[0].date, '04/05/2025');
    assert.deepEqual(
      requests.map(request => request.request),
      ['get_capabilities_v2', 'get_all', 'update_asin'],
    );

    const correction = requests[2].payload[0];
    const correctedValue = JSON.parse(correction.value);
    assert.equal(correction.ASIN, 'B012345678');
    assert.equal(correction.timestamp, 0);
    assert.equal(correctedValue.olderUnknown, true);
    assert.equal(correctedValue.newerUnknown, true);
    assert.equal(correctedValue.date, '04/05/2025');
  } finally {
    global.fetch = originalFetch;
  }
});
