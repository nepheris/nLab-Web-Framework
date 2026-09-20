/**
 * nLab Web Framework — Apps Script Security Core
 * Reusable helpers only. No project/business data belongs here.
 */
var NLabSecurityCore = (function () {
  'use strict';

  function props_() { return PropertiesService.getScriptProperties(); }
  function intProp_(name, fallback) {
    var raw = props_().getProperty(name);
    var n = Number(raw);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
  }
  function config() {
    return {
      googleClientId: props_().getProperty('NLAB_GOOGLE_CLIENT_ID') || '',
      usersFileId: props_().getProperty('NLAB_USERS_FILE_ID') || '',
      securityFolderId: props_().getProperty('NLAB_SECURITY_FOLDER_ID') || '',
      sessionTtlSeconds: intProp_('NLAB_SESSION_TTL_SECONDS', 1800),
      userCacheSeconds: intProp_('NLAB_USER_CACHE_SECONDS', 300),
      identityCacheSeconds: intProp_('NLAB_IDENTITY_CACHE_SECONDS', 300),
      rateMinute: intProp_('NLAB_RATE_LIMIT_MINUTE', 30),
      rateHour: intProp_('NLAB_RATE_LIMIT_HOUR', 300)
    };
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
  function safeJsonParse(raw, fallback) {
    try { return JSON.parse(raw); } catch (_) { return fallback; }
  }
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
  return {
    config: config,
    sha256: sha256,
    randomToken: randomToken,
    normalizeEmail: normalizeEmail,
    nowMs: nowMs,
    safeJsonParse: safeJsonParse,
    error: error,
    publicPrincipal: publicPrincipal
  };
})();
