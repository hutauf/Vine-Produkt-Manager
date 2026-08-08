const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const repositoryRoot = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(repositoryRoot, 'App.tsx'), 'utf8');

const transpiledApp = ts.transpileModule(appSource, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX,
    esModuleInterop: true,
  },
  fileName: 'App.tsx',
});

const appModule = { exports: {} };
vm.runInNewContext(transpiledApp.outputText, {
  module: appModule,
  exports: appModule.exports,
  require: () => ({}),
  URL,
  console,
}, { filename: 'App.js' });

const {
  apiBaseUrlSettingsAreEquivalent,
  apiTokenSettingsAreEquivalent,
  normalizeApiBaseUrlSetting,
  normalizeApiTokenSetting,
} = appModule.exports;

const getSourceSection = (startMarker, endMarker) => {
  const start = appSource.indexOf(startMarker);
  const end = appSource.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return appSource.slice(start, end);
};

test('unchanged API settings remain equivalent after trimming and URL normalization', () => {
  assert.equal(normalizeApiTokenSetting('  token-123  '), 'token-123');
  assert.equal(apiTokenSettingsAreEquivalent('token-123', '  token-123  '), true);
  assert.equal(apiTokenSettingsAreEquivalent(null, '   '), true);
  assert.equal(apiTokenSettingsAreEquivalent('token-123', 'token-456'), false);

  assert.equal(
    normalizeApiBaseUrlSetting('  https://example.test/data_operations  '),
    'https://example.test/data_operations',
  );
  assert.equal(
    apiBaseUrlSettingsAreEquivalent(
      'https://example.test/data_operations',
      '  HTTPS://EXAMPLE.TEST:443/data_operations/#ignored-fragment  ',
    ),
    true,
  );
  assert.equal(
    apiBaseUrlSettingsAreEquivalent(
      'https://example.test/data_operations',
      'https://example.test/other_endpoint',
    ),
    false,
  );
});

test('settings handlers guard equivalent values before starting a profile transition', () => {
  const urlHandler = getSourceSection(
    'const setApiBaseUrl = (newUrl: string) => {',
    'useEffect(() => {',
  );
  const tokenHandler = getSourceSection(
    'const handleApiTokenChange = (newToken: string) => {',
    'const handleDeleteAllServerData',
  );

  for (const [name, handler, guard] of [
    ['API URL', urlHandler, 'apiBaseUrlSettingsAreEquivalent'],
    ['API token', tokenHandler, 'apiTokenSettingsAreEquivalent'],
  ]) {
    const guardPosition = handler.indexOf(guard);
    const transitionPosition = handler.indexOf('beginProductProfileTransition()');
    assert.ok(guardPosition >= 0, `${name} handler must compare normalized values`);
    assert.ok(transitionPosition > guardPosition, `${name} guard must run before the profile transition`);
    assert.match(handler.slice(guardPosition, transitionPosition), /return;/);
  }
});
