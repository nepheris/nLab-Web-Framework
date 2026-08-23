import { promises as fs } from 'node:fs';
import path from 'node:path';

export class SiteGenerationOutputHandlerError extends Error {
  constructor(message, code = 'SITE_GENERATION_OUTPUT_HANDLER_ERROR', details = {}) {
    super(message);
    this.name = 'SiteGenerationOutputHandlerError';
    this.code = code;
    this.details = details;
  }
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function findArtifact(name, inputs, artifacts) {
  if (inputs && Object.prototype.hasOwnProperty.call(inputs, name)) return inputs[name];
  if (artifacts && Object.prototype.hasOwnProperty.call(artifacts, name)) return artifacts[name];
  return null;
}

function safeRelativePath(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new SiteGenerationOutputHandlerError(`${label} must be a non-empty string`, 'INVALID_OUTPUT_PATH', { label, value });
  }
  const raw = value.trim().replaceAll('\\', '/');
  if (raw.startsWith('/') || /^[A-Za-z]:\//.test(raw) || raw.includes('?') || raw.includes('#')) {
    throw new SiteGenerationOutputHandlerError(`${label} must be a safe relative path`, 'UNSAFE_OUTPUT_PATH', { label, value });
  }
  const normalized = path.posix.normalize(raw);
  if (normalized === '.' || normalized === '..' || normalized.startsWith('../') || normalized.split('/').includes('..')) {
    throw new SiteGenerationOutputHandlerError(`${label} escapes the declared output root`, 'UNSAFE_OUTPUT_PATH', { label, value });
  }
  return normalized.replace(/^\.\//, '');
}

function routeOutputFile(route) {
  if (typeof route.output_file === 'string' && route.output_file.trim()) {
    return safeRelativePath(route.output_file, 'route.output_file');
  }
  if (
    typeof route.path !== 'string' ||
    !route.path.startsWith('/') ||
    route.path.includes('\\') ||
    route.path.includes('?') ||
    route.path.includes('#')
  ) {
    throw new SiteGenerationOutputHandlerError('route.path must be a safe absolute public path', 'INVALID_ROUTE_PATH', { route });
  }
  const segments = route.path.split('/').filter(Boolean);
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    throw new SiteGenerationOutputHandlerError('route.path contains unsafe dot segments', 'INVALID_ROUTE_PATH', { route });
  }
  return segments.length ? `${segments.join('/')}/index.html` : 'index.html';
}

function normalizeRoutes(manifest, rendered) {
  if (!isObject(manifest) || !Array.isArray(manifest.routes)) {
    throw new SiteGenerationOutputHandlerError('routes.manifest.routes must be an array', 'INVALID_ROUTES_MANIFEST');
  }
  const targets = new Set();
  return manifest.routes.map((route, index) => {
    if (!isObject(route)) {
      throw new SiteGenerationOutputHandlerError('route entries must be objects', 'INVALID_ROUTE_ENTRY', { index });
    }
    const pageId = typeof route.page_id === 'string' ? route.page_id.trim() : '';
    if (!pageId || !Object.prototype.hasOwnProperty.call(rendered.pages, pageId)) {
      throw new SiteGenerationOutputHandlerError(`Unknown rendered page: ${pageId || '<empty>'}`, 'UNKNOWN_OUTPUT_PAGE', { index, pageId });
    }
    const target = routeOutputFile(route);
    if (targets.has(target)) {
      throw new SiteGenerationOutputHandlerError(`Duplicate page output target: ${target}`, 'DUPLICATE_OUTPUT_TARGET', { target });
    }
    targets.add(target);
    return { route, page_id: pageId, target };
  });
}

function normalizeAssets(prepared) {
  if (!isObject(prepared) || !Array.isArray(prepared.assets)) {
    throw new SiteGenerationOutputHandlerError('assets.prepared.assets must be an array', 'INVALID_ASSETS_PREPARED');
  }
  if (typeof prepared.output_root !== 'string' || !prepared.output_root.trim()) {
    throw new SiteGenerationOutputHandlerError('assets.prepared.output_root is required', 'ASSET_OUTPUT_ROOT_REQUIRED');
  }
  const targets = new Set();
  return prepared.assets
    .filter((entry) => entry?.status === 'prepared')
    .map((entry, index) => {
      if (!isObject(entry)) {
        throw new SiteGenerationOutputHandlerError('prepared asset entries must be objects', 'INVALID_PREPARED_ASSET', { index });
      }
      const target = safeRelativePath(entry.target, 'asset.target');
      if (targets.has(target)) {
        throw new SiteGenerationOutputHandlerError(`Duplicate asset output target: ${target}`, 'DUPLICATE_OUTPUT_TARGET', { target });
      }
      targets.add(target);
      return { ...entry, target };
    });
}

function failure(error) {
  return {
    status: 'fail',
    outputs: {},
    warnings: [],
    details: {
      reason: 'output_handler_error',
      error: {
        name: error?.name ?? 'Error',
        code: error?.code ?? null,
        message: error?.message ?? String(error),
        details: error?.details ?? null
      }
    }
  };
}

export function createOutputStageHandler({ outputRoot, fileSystem = fs } = {}) {
  if (typeof outputRoot !== 'string' || !outputRoot.trim()) {
    throw new SiteGenerationOutputHandlerError('outputRoot is required', 'OUTPUT_ROOT_REQUIRED');
  }
  if (!fileSystem || typeof fileSystem.readFile !== 'function' || typeof fileSystem.writeFile !== 'function' || typeof fileSystem.mkdir !== 'function') {
    throw new SiteGenerationOutputHandlerError('fileSystem readFile/writeFile/mkdir are required', 'INVALID_FILE_SYSTEM');
  }

  const outputBase = path.resolve(outputRoot);

  return async function outputStageHandler({ stage, inputs = {}, artifacts = {} } = {}) {
    if (stage?.type && stage.type !== 'output') {
      return {
        status: 'fail', outputs: {}, warnings: [],
        details: { reason: 'unexpected_stage_type', expected: 'output', actual: stage.type }
      };
    }

    const rendered = findArtifact('pages.rendered', inputs, artifacts);
    const prepared = findArtifact('assets.prepared', inputs, artifacts);
    const manifest = findArtifact('routes.manifest', inputs, artifacts);
    if (!isObject(rendered) || !isObject(rendered.pages)) {
      return { status: 'fail', outputs: {}, warnings: [], details: { reason: 'pages_rendered_artifact_required' } };
    }
    if (!prepared) {
      return { status: 'fail', outputs: {}, warnings: [], details: { reason: 'assets_prepared_artifact_required' } };
    }
    if (!manifest) {
      return { status: 'fail', outputs: {}, warnings: [], details: { reason: 'routes_manifest_artifact_required' } };
    }

    try {
      const routes = normalizeRoutes(manifest, rendered);
      const assets = normalizeAssets(prepared);
      const claimedTargets = new Set(routes.map((entry) => entry.target));
      for (const asset of assets) {
        if (claimedTargets.has(asset.target)) {
          throw new SiteGenerationOutputHandlerError(`Page/asset output collision: ${asset.target}`, 'OUTPUT_TARGET_COLLISION', { target: asset.target });
        }
        claimedTargets.add(asset.target);
      }

      await fileSystem.mkdir(outputBase, { recursive: true });
      const files = [];

      for (const entry of routes) {
        const page = rendered.pages[entry.page_id];
        if (typeof page?.content !== 'string') {
          throw new SiteGenerationOutputHandlerError(`Rendered page ${entry.page_id} has no string content`, 'INVALID_RENDERED_PAGE_CONTENT', { pageId: entry.page_id });
        }
        const absolute = path.resolve(outputBase, entry.target);
        await fileSystem.mkdir(path.dirname(absolute), { recursive: true });
        await fileSystem.writeFile(absolute, page.content, 'utf8');
        files.push({ kind: 'page', id: entry.page_id, path: entry.target, bytes: Buffer.byteLength(page.content, 'utf8') });
      }

      const assetBase = path.resolve(prepared.output_root);
      for (const asset of assets) {
        const source = path.resolve(assetBase, asset.target);
        const target = path.resolve(outputBase, asset.target);
        const data = await fileSystem.readFile(source);
        await fileSystem.mkdir(path.dirname(target), { recursive: true });
        await fileSystem.writeFile(target, data);
        files.push({ kind: 'asset', id: asset.id, path: asset.target, bytes: Number(data?.byteLength ?? data?.length ?? 0) });
      }

      files.sort((a, b) => a.path.localeCompare(b.path) || a.kind.localeCompare(b.kind) || String(a.id).localeCompare(String(b.id)));
      return {
        status: 'pass',
        outputs: {
          'web.output': {
            output_root: outputBase,
            files,
            file_count: files.length,
            page_count: files.filter((entry) => entry.kind === 'page').length,
            asset_count: files.filter((entry) => entry.kind === 'asset').length
          }
        },
        warnings: [],
        details: {
          files: files.length,
          pages: files.filter((entry) => entry.kind === 'page').length,
          assets: files.filter((entry) => entry.kind === 'asset').length,
          deterministic: true,
          referenced_nlab_artifacts: []
        }
      };
    } catch (error) {
      return failure(error);
    }
  };
}
