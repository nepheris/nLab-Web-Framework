const RESPONSES_SHEET = 'responses';

function getSpreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('Missing Script Property SPREADSHEET_ID');
  return SpreadsheetApp.openById(id);
}

function json_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function validateResponse_(payload) {
  const required = ['response_id', 'survey_id', 'survey_version', 'submitted_at', 'answers', 'path'];
  required.forEach((key) => {
    if (payload[key] === undefined || payload[key] === null) throw new Error('Missing field: ' + key);
  });
  if (typeof payload.answers !== 'object' || Array.isArray(payload.answers)) throw new Error('answers must be an object');
  if (!Array.isArray(payload.path)) throw new Error('path must be an array');
  if (JSON.stringify(payload).length > 50000) throw new Error('Payload too large');
}

function doPost(e) {
  try {
    const payload = JSON.parse((e.postData && e.postData.contents) || '{}');
    validateResponse_(payload);

    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      const sheet = getSpreadsheet_().getSheetByName(RESPONSES_SHEET);
      if (!sheet) throw new Error('Missing sheet: ' + RESPONSES_SHEET);
      sheet.appendRow([
        String(payload.response_id),
        String(payload.survey_id),
        String(payload.survey_version),
        String(payload.submitted_at),
        JSON.stringify(payload.context || {}),
        JSON.stringify(payload.answers || {}),
        JSON.stringify(payload.path || []),
        Number(payload.duration_ms || 0)
      ]);
    } finally {
      lock.releaseLock();
    }

    return json_({ ok: true, response_id: payload.response_id });
  } catch (error) {
    return json_({ ok: false, error: String(error && error.message ? error.message : error) });
  }
}

function doGet(e) {
  if ((e.parameter && e.parameter.health) === '1') {
    return json_({ ok: true, service: 'nlab-survey-flow', storage: 'google-sheet' });
  }
  return json_({ ok: false, error: 'Read endpoint not enabled in this MVP.' });
}
