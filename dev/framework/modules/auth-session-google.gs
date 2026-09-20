/**
 * nLab Web Framework — Google Identity -> opaque application session.
 */
var NLabAuthSession = (function () {
  'use strict';

  function verifyGoogleIdToken(idToken) {
    if (!idToken) throw NLabSecurityCore.error('id_token_missing', 'Google ID token is required.', 401);
    var cfg = NLabSecurityCore.config();
    if (!cfg.googleClientId) throw NLabSecurityCore.error('google_client_id_missing', 'Missing NLAB_GOOGLE_CLIENT_ID.', 500);

    var cache = CacheService.getScriptCache();
    var cacheKey = 'nlab:idv:' + NLabSecurityCore.sha256(idToken);
    var cached = cache.get(cacheKey);
    if (cached) {
      var hit = NLabSecurityCore.safeJsonParse(cached, null);
      if (hit) return hit;
    }

    var url = 'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken);
    var response = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
    if (response.getResponseCode() !== 200) throw NLabSecurityCore.error('identity_invalid', 'Google identity could not be verified.', 401);

    var info = NLabSecurityCore.safeJsonParse(response.getContentText(), null);
    if (!info) throw NLabSecurityCore.error('identity_invalid', 'Invalid Google token response.', 401);
    if (String(info.aud || '') !== cfg.googleClientId) throw NLabSecurityCore.error('identity_audience_invalid', 'Google token audience mismatch.', 401);
    if (!(info.email_verified === true || String(info.email_verified) === 'true')) throw NLabSecurityCore.error('identity_email_unverified', 'Google email is not verified.', 401);
    if (!info.email) throw NLabSecurityCore.error('identity_email_missing', 'Google token has no email.', 401);
    if (Number(info.exp || 0) * 1000 <= NLabSecurityCore.nowMs()) throw NLabSecurityCore.error('identity_expired', 'Google token is expired.', 401);

    var identity = {
      email: NLabSecurityCore.normalizeEmail(info.email),
      name: info.name || '',
      sub: info.sub || ''
    };
    cache.put(cacheKey, JSON.stringify(identity), Math.min(cfg.identityCacheSeconds, 600));
    return identity;
  }

  function createSession(identity, principal) {
    var cfg = NLabSecurityCore.config();
    var token = NLabSecurityCore.randomToken();
    var hash = NLabSecurityCore.sha256(token);
    var now = NLabSecurityCore.nowMs();
    var session = {
      email: principal.email,
      name: principal.name || identity.name || '',
      roles: principal.roles || [],
      permissions: principal.permissions || [],
      created_at: now,
      last_seen_at: now,
      expires_at: now + cfg.sessionTtlSeconds * 1000
    };
    CacheService.getScriptCache().put('nlab:sess:' + hash, JSON.stringify(session), Math.min(cfg.sessionTtlSeconds, 21600));
    return { token: token, session: session, expires_in: cfg.sessionTtlSeconds };
  }

  function readSession(token, refresh) {
    if (!token) throw NLabSecurityCore.error('session_missing', 'Session token is required.', 401);
    var cfg = NLabSecurityCore.config();
    var key = 'nlab:sess:' + NLabSecurityCore.sha256(token);
    var cache = CacheService.getScriptCache();
    var raw = cache.get(key);
    if (!raw) throw NLabSecurityCore.error('session_invalid', 'Session is invalid or expired.', 401);
    var session = NLabSecurityCore.safeJsonParse(raw, null);
    if (!session || Number(session.expires_at || 0) <= NLabSecurityCore.nowMs()) {
      cache.remove(key);
      throw NLabSecurityCore.error('session_expired', 'Session is expired.', 401);
    }
    if (refresh !== false) {
      var now = NLabSecurityCore.nowMs();
      session.last_seen_at = now;
      session.expires_at = now + cfg.sessionTtlSeconds * 1000;
      cache.put(key, JSON.stringify(session), Math.min(cfg.sessionTtlSeconds, 21600));
    }
    return session;
  }

  function logout(token) {
    if (token) CacheService.getScriptCache().remove('nlab:sess:' + NLabSecurityCore.sha256(token));
    return true;
  }

  return {
    verifyGoogleIdToken: verifyGoogleIdToken,
    createSession: createSession,
    readSession: readSession,
    logout: logout
  };
})();
