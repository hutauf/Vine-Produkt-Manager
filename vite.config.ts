import path from 'path';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    const packageVersion = JSON.parse(
      readFileSync(path.resolve(__dirname, 'package.json'), 'utf8')
    ).version as string;
    const buildCommit = (env.GITHUB_SHA || (() => {
      try {
        return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
      } catch {
        return 'unknown';
      }
    })()).slice(0, 7);
    const buildTime = new Date().toISOString();

    return {
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        __APP_VERSION__: JSON.stringify(packageVersion),
        __APP_BUILD_COMMIT__: JSON.stringify(buildCommit),
        __APP_BUILD_TIME__: JSON.stringify(buildTime)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
