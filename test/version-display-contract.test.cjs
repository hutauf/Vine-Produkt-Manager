const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repositoryRoot = path.resolve(__dirname, '..');

test('settings footer exposes package version, build commit and build time', () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8'),
  );
  const versionSource = fs.readFileSync(
    path.join(repositoryRoot, 'utils', 'appVersion.ts'),
    'utf8',
  );
  const settingsSource = fs.readFileSync(
    path.join(repositoryRoot, 'components', 'Pages', 'SettingsPage.tsx'),
    'utf8',
  );
  const viteSource = fs.readFileSync(path.join(repositoryRoot, 'vite.config.ts'), 'utf8');

  assert.equal(packageJson.version, '2.1.0');
  assert.match(viteSource, /__APP_VERSION__/);
  assert.match(viteSource, /__APP_BUILD_COMMIT__/);
  assert.match(viteSource, /__APP_BUILD_TIME__/);
  assert.match(versionSource, /export const APP_VERSION = __APP_VERSION__/);
  assert.match(settingsSource, /Vine Produkt Manager v\{APP_VERSION\}/);
  assert.match(settingsSource, /Build \{APP_BUILD_COMMIT\}/);
  assert.match(settingsSource, /\{APP_BUILD_TIME_LABEL\}/);
});
