/**
 * nLab Web Framework — Google/Apps Script identity -> opaque application session.
 *
 * Supported identity providers:
 * - apps_script_active_user: preferred for an Apps Script Web App deployed as USER_ACCESSING.
 * - google_identity_services: optional for external/static clients that can supply a Google ID token.
 *
 * All runtime parameters come from the project's central config.json.
 */
var NLabAuthSession = (function () {
  'use strict';

  function activeUserIdentity_() {
    var email = NLabSecurityCore.normalizeEmail(Session.getActiveUser().getEmail());
    if (!email) {
      throw NLabSecurityCore.error(
        'identity_email_unavailable',
        'Google account identity is unavailable. Deploy the Web App as user accessing the web app and require authorization.',
        401
      );
    }
    return { email: email, name: '', sub: '' };
  }

  function verifyGoogleIdToken_(idToken) {
    if (!idToken) throw NLabSecurityCore.error('id_token_missing', 'Google ID token is required.', 401);

    var sec = NLabSecurityCore.securityConfig(false);
    var identityCfg = sec.identity || {};
    var clientId = String(identityCfg.google_client_id || '').trim();
    if (!clientId || clientId.indexOf('__') === 0) {
      throw NLabSecurityCore.error('google_client_id_missing', 'Configure security.identity.google_client_id in config.json.', 500);
    }

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
    if (String(info.aud || '') !== clientId) throw NLabSecurityCore.error('identity_audience_invalid', 'Google token audience mismatch.', 401);
    if (identityCfg.require_email_verified !== false && !(info.email_verified === true || String(info.email_verified) === 'true')) {
      throw NLabSecurityCore.error('identity_email_unverified', 'Google email is not verified.', 401);
    }
    if (!info.email) throw NLabSecurityCore.error('identity_email_missing', 'Google token has no email.', 401);
    if (Number(info.exp || 0) * 1000 <= NLabSecurityCore.nowMs()) throw NLabSecurityCore.error('identity_expired', 'Google token is expired.', 401);

    var identity = {
      email: NLabSecurityCore.normalizeEmail(info.email),
      name: info.name || '',
      sub: info.sub || ''
    };
    var verifyTtl = NLabSecurityCore.number('cache.identity_verification_seconds', 300, 1);
    cache.put(cacheKey, JSON.stringify(identity), Math.min(Math.floor(verifyTtl), 600));
    return identity;
  }

  function resolveIdentity(idToken) {
    var provider = String(NLabSecurityCore.value('identity.provider', 'apps_script_active_user'));
    if (provider === 'apps_script_active_user') return activeUserIdentity_();
    if (provider === 'google_identity_services') return verifyGoogleIdToken_(idToken);
    throw NLabSecurityCore.error('identity_provider_unsupported', 'Unsupported identity provider: ' + provider, 500);
  }

  function createSession(identity, principal) {
    var ttl = NLabSecurityCore.number('session.ttl_seconds', 1800, 60);
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
      expires_at: now + ttl * 1000
    };
    CacheService.getScriptCache().put('nlab:sess:' + hash, JSON.stringify(session), Math.min(Math.floor(ttl), 21600));
    return { token: token, session: session, expires_in: ttl };
  }

  function readSession(token, refresh) {
    if (!token) throw NLabSecurityCore.error('session_missing', 'Session token is required.', 401);
    var key = 'nlab:sess:' + NLabSecurityCore.sha256(token);
    var cache = CacheService.getScriptCache();
    var raw = cache.get(key);
    if (!raw) throw NLabSecurityCore.error('session_invalid', 'Session is invalid or expired.', 401);

    var session = NLabSecurityCore.safeJsonParse(raw, null);
    if (!session || Number(session.expires_at || 0) <= NLabSecurityCore.nowMs()) {
      cache.remove(key);
      throw NLabSecurityCore.error('session_expired', 'Session is expired.', 401);
    }

    var sliding = NLabSecurityCore.value('session.sliding_expiration', true) !== false;
    if (refresh !== false && sliding) {
      var ttl = NLabSecurityCore.number('session.ttl_seconds', 1800, 60);
      var now = NLabSecurityCore.nowMs();
      session.last_seen_at = now;
      session.expires_at = now + ttl * 1000;
      cache.put(key, JSON.stringify(session), Math.min(Math.floor(ttl), 21600));
    }
    return session;
  }

  function logout(token) {
    if (token) CacheService.getScriptCache().remove('nlab:sess:' + NLabSecurityCore.sha256(token));
    return true;
  }

  return {
    resolveIdentity: resolveIdentity,
    createSession: createSession,
    readSession: readSession,
    logout: logout
  };
})();
