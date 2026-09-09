(function (global) {
  'use strict';

  const END = '__end__';

  function uuid() {
    if (global.crypto && typeof global.crypto.randomUUID === 'function') return global.crypto.randomUUID();
    return 'rsp-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function getValue(answers, field) {
    return field ? answers[field] : undefined;
  }

  function evaluateCondition(condition, answers) {
    if (!condition) return true;
    if (Array.isArray(condition.all)) return condition.all.every((item) => evaluateCondition(item, answers));
    if (Array.isArray(condition.any)) return condition.any.some((item) => evaluateCondition(item, answers));

    const actual = getValue(answers, condition.field);
    const expected = condition.value;
    switch (condition.op || 'eq') {
      case 'eq': return actual === expected;
      case 'neq': return actual !== expected;
      case 'includes': return Array.isArray(actual) ? actual.includes(expected) : String(actual ?? '').includes(String(expected));
      case 'not_includes': return Array.isArray(actual) ? !actual.includes(expected) : !String(actual ?? '').includes(String(expected));
      case 'gt': return Number(actual) > Number(expected);
      case 'gte': return Number(actual) >= Number(expected);
      case 'lt': return Number(actual) < Number(expected);
      case 'lte': return Number(actual) <= Number(expected);
      case 'truthy': return Boolean(actual);
      case 'not_empty': return Array.isArray(actual) ? actual.length > 0 : actual !== undefined && actual !== null && String(actual).trim() !== '';
      default: return false;
    }
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  class LocalStorageAdapter {
    constructor(prefix) {
      this.prefix = prefix || 'nlab.survey.responses';
    }

    key(surveyId) {
      return `${this.prefix}.${surveyId}`;
    }

    async submit(response) {
      const rows = this.list(response.survey_id);
      rows.push(response);
      localStorage.setItem(this.key(response.survey_id), JSON.stringify(rows));
      return { ok: true, response_id: response.response_id, storage: 'local_storage' };
    }

    list(surveyId) {
      try {
        const raw = localStorage.getItem(this.key(surveyId));
        return raw ? JSON.parse(raw) : [];
      } catch (_) {
        return [];
      }
    }

    clear(surveyId) {
      localStorage.removeItem(this.key(surveyId));
    }
  }

  class HttpApiAdapter {
    constructor(options) {
      this.endpoint = options?.endpoint;
      this.headers = options?.headers || {};
    }

    async submit(response) {
      if (!this.endpoint) throw new Error('Missing HTTP API endpoint');
      const result = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8', ...this.headers },
        body: JSON.stringify(response)
      });
      if (!result.ok) throw new Error(`Submission failed (${result.status})`);
      const text = await result.text();
      try { return JSON.parse(text); } catch (_) { return { ok: true, raw: text }; }
    }
  }

  class SurveyFlow {
    constructor(target, definition, options) {
      this.target = typeof target === 'string' ? document.querySelector(target) : target;
      if (!this.target) throw new Error('Survey target not found');
      this.definition = definition || {};
      this.options = options || {};
      this.steps = Array.isArray(this.definition.steps) ? this.definition.steps : [];
      this.stepMap = new Map(this.steps.map((step) => [step.id, step]));
      this.answers = {};
      this.history = [];
      this.path = [];
      this.currentId = this.definition.start || this.steps[0]?.id || END;
      this.startedAt = Date.now();
      this.submitting = false;
      this.adapter = this.resolveAdapter();
      this.validateDefinition();
    }

    resolveAdapter() {
      if (this.options.adapter) return this.options.adapter;
      const cfg = this.definition.submission || {};
      if (cfg.adapter === 'http_api') return new HttpApiAdapter(cfg);
      return new LocalStorageAdapter(cfg.storageKeyPrefix);
    }

    validateDefinition() {
      if (!this.definition.id) throw new Error('Survey definition requires id');
      if (!this.steps.length) throw new Error('Survey definition requires at least one step');
      const ids = new Set();
      this.steps.forEach((step) => {
        if (!step.id) throw new Error('Every survey step requires id');
        if (ids.has(step.id)) throw new Error(`Duplicate survey step id: ${step.id}`);
        ids.add(step.id);
      });
    }

    start() {
      this.render();
      return this;
    }

    get currentStep() {
      return this.stepMap.get(this.currentId);
    }

    progress() {
      const uniqueVisited = new Set(this.path.concat(this.currentId === END ? [] : [this.currentId]));
      return Math.min(100, Math.round((uniqueVisited.size / Math.max(1, this.steps.length)) * 100));
    }

    optionForAnswer(step, answer) {
      if (!Array.isArray(step.options)) return null;
      if (Array.isArray(answer)) return null;
      return step.options.find((option) => option.value === answer) || null;
    }

    resolveNext(step) {
      const directOption = this.optionForAnswer(step, this.answers[step.id]);
      if (directOption?.next) return directOption.next;

      if (typeof step.next === 'string') return step.next;
      if (Array.isArray(step.next)) {
        let fallback = null;
        for (const rule of step.next) {
          if (rule.otherwise) fallback = rule.otherwise;
          else if (evaluateCondition(rule.when, this.answers)) return rule.go || END;
        }
        if (fallback) return fallback;
      }

      const index = this.steps.findIndex((candidate) => candidate.id === step.id);
      return this.steps[index + 1]?.id || END;
    }

    readValue(step) {
      const form = this.target.querySelector('[data-survey-form]');
      if (!form) return undefined;
      const name = `q_${step.id}`;
      switch (step.type) {
        case 'multiple_choice':
          return Array.from(form.querySelectorAll(`input[name="${name}"]:checked`)).map((el) => el.value);
        case 'single_choice':
        case 'yes_no':
        case 'rating': {
          const checked = form.querySelector(`input[name="${name}"]:checked`);
          return checked ? checked.value : undefined;
        }
        case 'number': {
          const input = form.querySelector(`[name="${name}"]`);
          return input && input.value !== '' ? Number(input.value) : undefined;
        }
        case 'short_text':
        case 'long_text': {
          const input = form.querySelector(`[name="${name}"]`);
          return input ? input.value.trim() : undefined;
        }
        case 'info': return true;
        default: return undefined;
      }
    }

    validateAnswer(step, value) {
      if (!step.required || step.type === 'info') return true;
      if (Array.isArray(value)) return value.length > 0;
      return value !== undefined && value !== null && String(value).trim() !== '';
    }

    async next() {
      const step = this.currentStep;
      if (!step || this.submitting) return;
      const value = this.readValue(step);
      if (!this.validateAnswer(step, value)) {
        const error = this.target.querySelector('[data-survey-error]');
        if (error) error.textContent = 'Merci de répondre avant de continuer.';
        return;
      }
      if (step.type !== 'info' && value !== undefined) this.answers[step.id] = value;
      if (!this.path.includes(step.id)) this.path.push(step.id);
      this.history.push(step.id);
      const destination = this.resolveNext(step);
      if (destination === END) {
        await this.submit();
        return;
      }
      if (!this.stepMap.has(destination)) throw new Error(`Unknown survey destination: ${destination}`);
      this.currentId = destination;
      this.render();
    }

    back() {
      if (!this.history.length || this.submitting) return;
      const previous = this.history.pop();
      this.currentId = previous;
      const lastIndex = this.path.lastIndexOf(previous);
      if (lastIndex >= 0) this.path = this.path.slice(0, lastIndex);
      this.render();
    }

    makeResponse() {
      return {
        response_id: uuid(),
        survey_id: this.definition.id,
        survey_version: this.definition.version || '1.0.0',
        submitted_at: new Date().toISOString(),
        context: this.definition.context || {},
        answers: { ...this.answers },
        path: [...this.path],
        duration_ms: Date.now() - this.startedAt
      };
    }

    async submit() {
      this.submitting = true;
      this.renderSubmitting();
      const response = this.makeResponse();
      try {
        const result = this.options.onSubmit
          ? await this.options.onSubmit(response, this.adapter)
          : await this.adapter.submit(response);
        this.currentId = END;
        this.submitting = false;
        this.renderCompleted(response, result);
        if (typeof this.options.onComplete === 'function') this.options.onComplete(response, result);
      } catch (error) {
        this.submitting = false;
        this.render();
        const node = this.target.querySelector('[data-survey-error]');
        if (node) node.textContent = `Envoi impossible : ${error.message}`;
      }
    }

    renderSubmitting() {
      this.target.innerHTML = `<section class="nlab-survey-card"><p class="nlab-survey-kicker">${escapeHtml(this.definition.title || 'Questionnaire')}</p><h2>Enregistrement…</h2><p>La réponse est en cours de traitement.</p></section>`;
    }

    renderCompleted(response, result) {
      const policy = this.definition.results?.policy || 'hidden';
      let resultsHtml = '';
      if ((policy === 'after_submit' || policy === 'live') && this.adapter instanceof LocalStorageAdapter) {
        resultsHtml = this.renderLocalResults();
      }
      this.target.innerHTML = `
        <section class="nlab-survey-card nlab-survey-complete">
          <p class="nlab-survey-kicker">${escapeHtml(this.definition.title || 'Questionnaire')}</p>
          <h2>${escapeHtml(this.definition.completed?.title || 'Merci pour votre réponse')}</h2>
          <p>${escapeHtml(this.definition.completed?.message || 'Votre retour a bien été enregistré.')}</p>
          ${result?.storage === 'local_storage' ? '<p class="nlab-survey-note">POC : cette réponse est stockée uniquement dans ce navigateur.</p>' : ''}
          ${resultsHtml}
          <button type="button" data-survey-restart>Répondre à nouveau</button>
        </section>`;
      this.target.querySelector('[data-survey-restart]')?.addEventListener('click', () => this.restart());
    }

    renderLocalResults() {
      const rows = this.adapter.list(this.definition.id);
      const resultQuestion = this.definition.results?.questionId;
      const step = this.stepMap.get(resultQuestion);
      if (!step || !Array.isArray(step.options)) return '';
      const counts = Object.fromEntries(step.options.map((option) => [option.value, 0]));
      rows.forEach((row) => {
        const value = row.answers?.[resultQuestion];
        if (Object.prototype.hasOwnProperty.call(counts, value)) counts[value] += 1;
      });
      const total = Math.max(1, Object.values(counts).reduce((a, b) => a + b, 0));
      const lines = step.options.map((option) => {
        const count = counts[option.value] || 0;
        const pct = Math.round((count / total) * 100);
        return `<li><span>${escapeHtml(option.label)}</span><strong>${count} · ${pct}%</strong></li>`;
      }).join('');
      return `<div class="nlab-survey-results"><h3>Résultats sur ce navigateur</h3><ul>${lines}</ul></div>`;
    }

    restart() {
      this.answers = {};
      this.history = [];
      this.path = [];
      this.currentId = this.definition.start || this.steps[0].id;
      this.startedAt = Date.now();
      this.render();
    }

    renderQuestion(step) {
      const name = `q_${step.id}`;
      const existing = this.answers[step.id];
      if (step.type === 'info') return '<p class="nlab-survey-info">' + escapeHtml(step.description || '') + '</p>';

      if (['single_choice', 'yes_no', 'rating'].includes(step.type)) {
        const options = step.options || (step.type === 'yes_no' ? [
          { value: 'yes', label: 'Oui' }, { value: 'no', label: 'Non' }
        ] : []);
        return `<div class="nlab-survey-options">${options.map((option) => `
          <label class="nlab-survey-option">
            <input type="radio" name="${name}" value="${escapeHtml(option.value)}" ${existing === option.value ? 'checked' : ''}>
            <span>${escapeHtml(option.label)}</span>
          </label>`).join('')}</div>`;
      }

      if (step.type === 'multiple_choice') {
        const selected = Array.isArray(existing) ? existing : [];
        return `<div class="nlab-survey-options">${(step.options || []).map((option) => `
          <label class="nlab-survey-option">
            <input type="checkbox" name="${name}" value="${escapeHtml(option.value)}" ${selected.includes(option.value) ? 'checked' : ''}>
            <span>${escapeHtml(option.label)}</span>
          </label>`).join('')}</div>`;
      }

      if (step.type === 'long_text') {
        return `<textarea name="${name}" rows="5" placeholder="${escapeHtml(step.placeholder || '')}">${escapeHtml(existing || '')}</textarea>`;
      }
      if (step.type === 'number') {
        return `<input type="number" name="${name}" value="${escapeHtml(existing ?? '')}" ${step.min !== undefined ? `min="${step.min}"` : ''} ${step.max !== undefined ? `max="${step.max}"` : ''}>`;
      }
      return `<input type="text" name="${name}" value="${escapeHtml(existing || '')}" placeholder="${escapeHtml(step.placeholder || '')}">`;
    }

    render() {
      const step = this.currentStep;
      if (!step) return;
      this.target.innerHTML = `
        <section class="nlab-survey-card">
          <div class="nlab-survey-head">
            <div>
              <p class="nlab-survey-kicker">${escapeHtml(this.definition.title || 'Questionnaire')}</p>
              <h2>${escapeHtml(step.question || '')}</h2>
              ${step.description ? `<p>${escapeHtml(step.description)}</p>` : ''}
            </div>
            ${this.definition.ui?.showProgress === false ? '' : `<div class="nlab-survey-progress" aria-label="Progression"><span style="width:${this.progress()}%"></span></div>`}
          </div>
          <form data-survey-form>
            ${this.renderQuestion(step)}
            <p class="nlab-survey-error" data-survey-error aria-live="polite"></p>
            <div class="nlab-survey-actions">
              <button type="button" class="secondary" data-survey-back ${this.history.length ? '' : 'disabled'}>Précédent</button>
              <button type="submit">${this.resolveNext(step) === END ? 'Envoyer' : 'Continuer'}</button>
            </div>
          </form>
        </section>`;

      this.target.querySelector('[data-survey-form]')?.addEventListener('submit', (event) => {
        event.preventDefault();
        this.next();
      });
      this.target.querySelector('[data-survey-back]')?.addEventListener('click', () => this.back());
    }
  }

  global.NLabSurveyFlow = {
    END,
    SurveyFlow,
    LocalStorageAdapter,
    HttpApiAdapter,
    evaluateCondition
  };
})(typeof window !== 'undefined' ? window : globalThis);
