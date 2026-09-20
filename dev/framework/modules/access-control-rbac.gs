/**
 * nLab Web Framework — RBAC Access Control
 * Users/roles stay in the project's private users.json.
 * The users file ID and cache TTL come from the central config.json.
 */
var NLabAccessControl = (function () {
  'use strict';
  var CACHE_KEY = 'nlab:security:users:v3';

  function readUsersFile_() {
    var sec = NLabSecurityCore.securityConfig(false);
    var access = sec.access_control || {};
    var fileId = String(access.users_file_id || '').trim();

    if (fileId) return DriveApp.getFileById(fileId).getBlob().getDataAsString('UTF-8');

    var folderId = String(access.security_folder_id || '').trim();
    var fileName = String(access.users_file_name || 'users.json');
    if (!folderId) {
      throw NLabSecurityCore.error('users_file_config_missing', 'Configure security.access_control.users_file_id or security_folder_id.', 500);
    }
    var it = DriveApp.getFolderById(folderId).getFilesByName(fileName);
    if (!it.hasNext()) throw NLabSecurityCore.error('users_file_missing', fileName + ' not found.', 500);
    return it.next().getBlob().getDataAsString('UTF-8');
  }

  function loadConfig(forceRefresh) {
    var cache = CacheService.getScriptCache();
    if (!forceRefresh) {
      var cached = cache.get(CACHE_KEY);
      if (cached) {
        var parsed = NLabSecurityCore.safeJsonParse(cached, null);
        if (parsed) return parsed;
      }
    }
    var data = NLabSecurityCore.safeJsonParse(readUsersFile_(), null);
    if (!data || !Array.isArray(data.users) || typeof data.roles !== 'object') {
      throw NLabSecurityCore.error('users_file_invalid', 'Invalid users.json contract.', 500);
    }
    var ttl = NLabSecurityCore.number('cache.user_permissions_seconds', 300, 1);
    cache.put(CACHE_KEY, JSON.stringify(data), Math.min(Math.floor(ttl), 21600));
    return data;
  }

  function matchPermission_(granted, required) {
    if (granted === '*' || granted === required) return true;
    if (granted && granted.endsWith('*')) return required.indexOf(granted.slice(0, -1)) === 0;
    return false;
  }

  function principalForEmail(email) {
    var normalized = NLabSecurityCore.normalizeEmail(email);
    var config = loadConfig(false);
    var user = config.users.find(function (u) { return NLabSecurityCore.normalizeEmail(u.email) === normalized; });
    if (!user || user.active !== true) throw NLabSecurityCore.error('access_denied', 'User is not authorized.', 403);

    var roles = Array.isArray(user.roles) ? user.roles : [];
    var permissions = [];
    roles.forEach(function (role) {
      var list = config.roles[role];
      if (!Array.isArray(list)) throw NLabSecurityCore.error('unknown_role', 'Unknown role: ' + role, 403);
      permissions = permissions.concat(list);
    });
    if (Array.isArray(user.permissions)) permissions = permissions.concat(user.permissions);
    permissions = Array.from(new Set(permissions));

    return {
      email: normalized,
      name: user.name || '',
      roles: roles.slice(),
      permissions: permissions
    };
  }

  function requirePermission(principal, required) {
    if (!required) return true;
    var ok = (principal.permissions || []).some(function (granted) { return matchPermission_(granted, required); });
    if (!ok) throw NLabSecurityCore.error('permission_denied', 'Missing permission: ' + required, 403);
    return true;
  }

  function invalidate() {
    CacheService.getScriptCache().remove(CACHE_KEY);
  }

  return {
    loadConfig: loadConfig,
    principalForEmail: principalForEmail,
    requirePermission: requirePermission,
    invalidate: invalidate
  };
})();
