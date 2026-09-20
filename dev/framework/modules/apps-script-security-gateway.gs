/**
 * nLab Web Framework — Apps Script API security gateway.
 * Project supplies a server-side route table:
 * {
 *   "order.get": { permission:"orders:read", handler:function(payload,ctx){...} }
 * }
 */
var NLabSecurityGateway = (function () {
  'use strict';

  function audit_(event, data) {
    var safe = Object.assign({}, data || {});
    delete safe.id_token;
    delete safe.session_token;
    console.log(JSON.stringify({ ts: new Date().toISOString(), event: event, data: safe }));
  }

  function login_(body) {
    var provider = String(NLabSecurityCore.value('identity.provider', 'apps_script_active_user'));
    var loginSubject = provider === 'apps_script_active_user'
      ? ('active-user:' + Session.getTemporaryActiveUserKey())
      : ('id-token:' + NLabSecurityCore.sha256(body.id_token || '').slice(0, 24));
    NLabRateLimit.check(loginSubject, 'auth.login');
    var identity = NLabAuthSession.resolveIdentity(body.id_token);
    var principal = NLabAccessControl.principalForEmail(identity.email);
    var created = NLabAuthSession.createSession(identity, principal);
    audit_('auth.login.ok', { email: principal.email, roles: principal.roles });
    return {
      ok: true,
      session_token: created.token,
      expires_in: created.expires_in,
      principal: NLabSecurityCore.publicPrincipal(principal)
    };
  }

  function dispatch(body, routes) {
    body = body || {};
    routes = routes || {};
    var action = String(body.action || '').trim();
    if (!action) throw NLabSecurityCore.error('action_missing', 'Action is required.', 400);
    if (action === 'auth.login') return login_(body);

    var session = NLabAuthSession.readSession(body.session_token, true);
    var principal = NLabAccessControl.principalForEmail(session.email);
    var rate = NLabRateLimit.check(principal.email, action);

    if (action === 'auth.logout') {
      NLabAuthSession.logout(body.session_token);
      audit_('auth.logout', { email: principal.email });
      return { ok: true };
    }
    if (action === 'auth.me') {
      return { ok: true, principal: NLabSecurityCore.publicPrincipal(principal), rate: rate };
    }

    var route = routes[action];
    if (!route || typeof route.handler !== 'function') throw NLabSecurityCore.error('route_not_found', 'Unknown action.', 404);
    NLabAccessControl.requirePermission(principal, route.permission || null);

    var context = {
      principal: principal,
      action: action,
      rate: rate,
      requested_at: new Date().toISOString()
    };
    var result = route.handler(body.payload || {}, context);
    audit_('api.action.ok', { email: principal.email, action: action });
    return { ok: true, data: result, rate: rate };
  }

  function fromEvent(e, routes) {
    var body = {};
    if (e && e.postData && e.postData.contents) {
      body = NLabSecurityCore.safeJsonParse(e.postData.contents, null);
      if (!body) throw NLabSecurityCore.error('json_invalid', 'Request body must be valid JSON.', 400);
    }
    return dispatch(body, routes);
  }

  function errorPayload(err) {
    audit_('api.error', { code: err.code || 'error', status: err.status || 500 });
    return {
      ok: false,
      error: {
        code: err.code || 'internal_error',
        message: err.status && err.status < 500 ? err.message : 'Internal server error.',
        status: err.status || 500,
        details: err.details || null
      }
    };
  }

  function jsonOutput(payload) {
    return ContentService.createTextOutput(JSON.stringify(payload))
      .setMimeType(ContentService.MimeType.JSON);
  }

  return {
    dispatch: dispatch,
    fromEvent: fromEvent,
    errorPayload: errorPayload,
    jsonOutput: jsonOutput
  };
})();
