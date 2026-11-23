import { defineConfig, type Plugin } from 'vite';
import { resolve } from 'path';
import { cpSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs';

function clearVoiceBuildPlugin(): Plugin {
  return {
    name: 'clearvoice-build-plugin',
    closeBundle() {
      const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8')) as { version: string };
      const distManifestPath = resolve(__dirname, 'dist/manifest.json');
      if (existsSync(distManifestPath)) {
        const manifest = JSON.parse(readFileSync(distManifestPath, 'utf-8')) as { version: string };
        manifest.version = pkg.version;
        writeFileSync(distManifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
      }

      // Copy WASM runtime dependencies
      const distWasmDir = resolve(__dirname, 'dist/wasm');
      mkdirSync(distWasmDir, { recursive: true });
      for (const file of ['ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm']) {
        const fromNodeModules = resolve(__dirname, 'node_modules/onnxruntime-web/dist', file);
        const fromPublic = resolve(__dirname, 'public/wasm', file);
        const src = existsSync(fromNodeModules) ? fromNodeModules : fromPublic;
        if (existsSync(src)) {
          copyFileSync(src, resolve(distWasmDir, file));
        }
      }

      // Copy bundled offline AI model files if present
      const publicModelsDir = resolve(__dirname, 'public/models');
      const distModelsDir = resolve(__dirname, 'dist/models');
      if (existsSync(publicModelsDir)) {
        mkdirSync(distModelsDir, { recursive: true });
        cpSync(publicModelsDir, distModelsDir, { recursive: true });
      }

      // Remove duplicate hashed .wasm emitted in dist/assets since we serve canonical dist/wasm/*
      const distAssetsDir = resolve(__dirname, 'dist/assets');
      if (existsSync(distAssetsDir)) {
        for (const f of readdirSync(distAssetsDir)) {
          if (f.endsWith('.wasm')) {
            unlinkSync(resolve(distAssetsDir, f));
          }
        }
      }
    },
  };
}

export default defineConfig({
  plugins: [clearVoiceBuildPlugin()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'src/popup/index.html'),
        offscreen: resolve(__dirname, 'src/offscreen/offscreen.html'),
        background: resolve(__dirname, 'src/background/service-worker.ts'),
        content: resolve(__dirname, 'src/content/overlay.ts'),
      },
      output: {
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === 'background') {
            return 'background.js';
          }
          if (chunkInfo.name === 'content') {
            return 'content.js';
          }
          return 'assets/[name]-[hash].js';
        },
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: (assetInfo) => {
          if (assetInfo.name && (assetInfo.name.includes('overlay') || assetInfo.name.includes('content'))) {
            return 'content.css';
          }
          return 'assets/[name]-[hash].[ext]';
        },
      },
    },
  },
});
