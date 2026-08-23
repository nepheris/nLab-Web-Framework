import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createOutputStageHandler } from '../tools/site/handlers/output-handler.mjs';

const root = await mkdtemp(path.join(os.tmpdir(), 'nlab-output-'));
const preparedRoot = path.join(root, 'prepared');
const outputRoot = path.join(root, 'web');

try {
  await mkdir(path.join(preparedRoot, 'assets'), { recursive: true });
  await writeFile(path.join(preparedRoot, 'assets/app.css'), 'body{}');

  const handler = createOutputStageHandler({ outputRoot });
  const artifacts = {
    'pages.rendered': { pages: { home: { content: '<h1>Home</h1>' }, about: { content: '<h1>About</h1>' } } },
    'assets.prepared': { output_root: preparedRoot, assets: [{ id: 'css', target: 'assets/app.css', status: 'prepared' }] },
    'routes.manifest': { routes: [{ id: 'home', page_id: 'home', path: '/' }, { id: 'about', page_id: 'about', path: '/about' }] }
  };

  const nominal = await handler({ stage: { type: 'output' }, artifacts });
  assert.equal(nominal.status, 'pass');
  assert.equal(nominal.outputs['web.output'].file_count, 3);
  assert.equal(await readFile(path.join(outputRoot, 'index.html'), 'utf8'), '<h1>Home</h1>');
  assert.equal(await readFile(path.join(outputRoot, 'about/index.html'), 'utf8'), '<h1>About</h1>');
  assert.equal(await readFile(path.join(outputRoot, 'assets/app.css'), 'utf8'), 'body{}');

  const collision = await handler({ stage: { type: 'output' }, artifacts: { ...artifacts, 'assets.prepared': { output_root: preparedRoot, assets: [{ id: 'bad', target: 'index.html', status: 'prepared' }] } } });
  assert.equal(collision.status, 'fail');
  assert.equal(collision.details.error.code, 'OUTPUT_TARGET_COLLISION');

  const unknown = await handler({ stage: { type: 'output' }, artifacts: { ...artifacts, 'routes.manifest': { routes: [{ id: 'x', page_id: 'missing', path: '/x' }] } } });
  assert.equal(unknown.status, 'fail');
  assert.equal(unknown.details.error.code, 'UNKNOWN_OUTPUT_PAGE');

  const wrong = await handler({ stage: { type: 'render' }, artifacts });
  assert.equal(wrong.status, 'fail');
  assert.equal(wrong.details.reason, 'unexpected_stage_type');

  console.log('site generation output handler tests: ok');
} finally {
  await rm(root, { recursive: true, force: true });
}
