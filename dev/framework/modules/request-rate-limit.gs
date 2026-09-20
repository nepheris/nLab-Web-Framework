/**
 * nLab Web Framework — simple server-side minute/hour rate limiter.
 * Limits are loaded from project config.json.
 */
var NLabRateLimit = (function () {
  'use strict';

  function timeKey_(kind, now) {
    var d = new Date(now);
    var base = Utilities.formatDate(d, 'UTC', 'yyyyMMddHH');
    return kind === 'minute' ? base + Utilities.formatDate(d, 'UTC', 'mm') : base;
  }

  function increment_(cache, key, ttl) {
    var n = Number(cache.get(key) || '0') + 1;
    cache.put(key, String(n), ttl);
    return n;
  }

  function limitsFor_(route) {
    var sec = NLabSecurityCore.securityConfig(false);
    var rate = sec.rate_limits || {};
    var selected = route === 'auth.login' ? (rate.login || {}) : (rate.per_user || {});
    return {
      minute: Number(selected.requests_per_minute || 30),
      hour: Number(selected.requests_per_hour || 300)
    };
  }

  function check(subject, route) {
    var limits = limitsFor_(route);
    var now = NLabSecurityCore.nowMs();
    var subjectHash = NLabSecurityCore.sha256(String(subject || 'anonymous')).slice(0, 24);
    var routeHash = NLabSecurityCore.sha256(String(route || '*')).slice(0, 12);
    var mKey = 'nlab:rl:m:' + subjectHash + ':' + routeHash + ':' + timeKey_('minute', now);
    var hKey = 'nlab:rl:h:' + subjectHash + ':' + routeHash + ':' + timeKey_('hour', now);

    var lock = LockService.getScriptLock();
    if (!lock.tryLock(2000)) throw NLabSecurityCore.error('rate_limit_busy', 'Rate limiter is busy.', 503);
    try {
      var cache = CacheService.getScriptCache();
      var minuteCount = increment_(cache, mKey, 120);
      var hourCount = increment_(cache, hKey, 3700);

      if (minuteCount > limits.minute) {
        throw NLabSecurityCore.error('rate_limited', 'Too many requests.', 429, { retry_after_seconds: 60 });
      }
      if (hourCount > limits.hour) {
        throw NLabSecurityCore.error('rate_limited', 'Too many requests.', 429, { retry_after_seconds: 3600 });
      }
      return {
        minute_remaining: Math.max(0, limits.minute - minuteCount),
        hour_remaining: Math.max(0, limits.hour - hourCount)
      };
    } finally {
      lock.releaseLock();
    }
  }

  return { check: check };
})();
