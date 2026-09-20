/**
 * nLab Web Framework — Apps Script Security Core
 * Reusable helpers only. Project runtime settings live in ONE private config.json.
 *
 * Bootstrap rule:
 *   Script Property NLAB_CONFIG_FILE_ID = Drive file ID of project config.json
 * Every tunable security value is then loaded from config.json.
 */
var NLabSecurityCore = (function () {
  'use strict';
  var CONFIG_CACHE_KEY = 'nlab:project-config:v1';
  var BOOTSTRAP_CONFIG_CACHE_SECONDS = 300;

  function props_() { return PropertiesService.getScriptProperties(); }

  function safeJsonParse(raw, fallback) {
    try { return JSON.parse(raw); } catch (_) { return fallback; }
  }

  function loadProjectConfig(forceRefresh) {
    var fileId = props_().getProperty('NLAB_CONFIG_FILE_ID') || '';
    if (!fileId) throw error('config_file_id_missing', 'Missing Script Property NLAB_CONFIG_FILE_ID.', 500);

    var cache = CacheService.getScriptCache();
    if (!forceRefresh) {
      var cached = cache.get(CONFIG_CACHE_KEY);
      if (cached) {
        var parsed = safeJsonParse(cached, null);
        if (parsed) return parsed;
      }
    }

    var raw = DriveApp.getFileById(fileId).getBlob().getDataAsString('UTF-8');
    var project = safeJsonParse(raw, null);
    if (!project || typeof project !== 'object') {
      throw error('config_invalid', 'Project config.json is invalid.', 500);
    }
    if (!project.security || project.security.enabled !== true) {
      throw error('security_config_missing', 'config.json must contain security.enabled=true.', 500);
    }

    var ttl = Number(project.security.cache && project.security.cache.config_seconds);
    if (!Number.isFinite(ttl) || ttl < 1) ttl = BOOTSTRAP_CONFIG_CACHE_SECONDS;
    cache.put(CONFIG_CACHE_KEY, JSON.stringify(project), Math.min(Math.floor(ttl), 21600));
    return project;
  }

  function securityConfig(forceRefresh) {
    return loadProjectConfig(!!forceRefresh).security;
  }

  function value(path, fallback) {
    var cur = securityConfig(false);
    String(path || '').split('.').filter(Boolean).forEach(function (part) {
      cur = cur && Object.prototype.hasOwnProperty.call(cur, part) ? cur[part] : undefined;
    });
    return cur === undefined || cur === null ? fallback : cur;
  }

  function number(path, fallback, min) {
    var n = Number(value(path, fallback));
    min = min === undefined ? 0 : min;
    return Number.isFinite(n) && n >= min ? n : fallback;
  }

  function sha256(text) {
    var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(text), Utilities.Charset.UTF_8);
    return bytes.map(function (b) { var v = b < 0 ? b + 256 : b; return ('0' + v.toString(16)).slice(-2); }).join('');
  }

  function randomToken() {
    return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  }

  function normalizeEmail(email) { return String(email || '').trim().toLowerCase(); }
  function nowMs() { return Date.now(); }

  function error(code, message, status, details) {
    var e = new Error(message || code);
    e.code = code || 'error';
    e.status = status || 400;
    e.details = details || null;
    return e;
  }

  function publicPrincipal(principal) {
    return {
      email: principal.email,
      name: principal.name || '',
      roles: (principal.roles || []).slice()
    };
  }

  function invalidateProjectConfig() {
    CacheService.getScriptCache().remove(CONFIG_CACHE_KEY);
  }

  return {
    loadProjectConfig: loadProjectConfig,
    securityConfig: securityConfig,
    value: value,
    number: number,
    sha256: sha256,
    randomToken: randomToken,
    normalizeEmail: normalizeEmail,
    nowMs: nowMs,
    safeJsonParse: safeJsonParse,
    error: error,
    publicPrincipal: publicPrincipal,
    invalidateProjectConfig: invalidateProjectConfig
  };
})();
