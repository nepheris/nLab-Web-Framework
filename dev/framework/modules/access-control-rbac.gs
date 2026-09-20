/**
 * nLab Web Framework — RBAC Access Control
 * Project users/roles are loaded from a private users.json file in Drive.
 */
var NLabAccessControl = (function () {
  'use strict';
  var CACHE_KEY = 'nlab:security:users:v2';

  function readUsersFile_() {
    var cfg = NLabSecurityCore.config();
    var file = null;
    if (cfg.usersFileId) {
      file = DriveApp.getFileById(cfg.usersFileId);
    } else {
      if (!cfg.securityFolderId) throw NLabSecurityCore.error('security_config_missing', 'Missing NLAB_USERS_FILE_ID or NLAB_SECURITY_FOLDER_ID.', 500);
      var it = DriveApp.getFolderById(cfg.securityFolderId).getFilesByName('users.json');
      if (!it.hasNext()) throw NLabSecurityCore.error('users_file_missing', 'users.json not found.', 500);
      file = it.next();
    }
    return file.getBlob().getDataAsString('UTF-8');
  }

  function loadConfig(forceRefresh) {
    var cache = CacheService.getScriptCache();
    var cfg = NLabSecurityCore.config();
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
    cache.put(CACHE_KEY, JSON.stringify(data), Math.min(cfg.userCacheSeconds, 21600));
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
