/**
 * nLab Web Framework — simple server-side minute/hour rate limiter.
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

  function check(subject, route) {
    var cfg = NLabSecurityCore.config();
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
      if (minuteCount > cfg.rateMinute) {
        throw NLabSecurityCore.error('rate_limited', 'Too many requests.', 429, { retry_after_seconds: 60 });
      }
      if (hourCount > cfg.rateHour) {
        throw NLabSecurityCore.error('rate_limited', 'Too many requests.', 429, { retry_after_seconds: 3600 });
      }
      return {
        minute_remaining: Math.max(0, cfg.rateMinute - minuteCount),
        hour_remaining: Math.max(0, cfg.rateHour - hourCount)
      };
    } finally {
      lock.releaseLock();
    }
  }

  return { check: check };
})();
