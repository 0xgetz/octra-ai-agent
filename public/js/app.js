/* ══════════════════════════════════════════════
   OCTRA NETWORK AI AGENT v3.0.0 - APPLICATION
   Multi-provider · agentic tools · RAG · multi-agent autopilot
   ══════════════════════════════════════════════ */

/* ── Shared provider catalogue (fallback; refreshed from /api/models) ── */

var PROVIDER_ORDER = ['openai', 'claude', 'gemini', 'groq', 'openrouter'];
var PROVIDER_LABELS = {
  openai: 'OpenAI', claude: 'Claude', gemini: 'Gemini', groq: 'Groq', openrouter: 'OpenRouter',
};
var MODEL_CATALOGUE = {
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo'],
  claude: ['claude-opus-4-5', 'claude-sonnet-4-5', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229'],
  gemini: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-pro'],
  groq: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768', 'gemma2-9b-it'],
  openrouter: ['openai/gpt-4o', 'anthropic/claude-sonnet-4-5', 'google/gemini-2.5-flash', 'meta-llama/llama-3.3-70b-instruct', 'deepseek/deepseek-chat'],
};

function prettyModel(id) {
  return id
    .replace(/-/g, ' ')
    .replace(/\b\w/g, function (c) { return c.toUpperCase(); })
    .replace('Gpt', 'GPT');
}

// Approximate cost per 1M tokens (USD). Unknown models simply show no cost.
var COST_PER_1M = {
  'gpt-4o': { input: 5.0, output: 15.0 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4-turbo': { input: 10.0, output: 30.0 },
  'gpt-4': { input: 30.0, output: 60.0 },
  'gpt-3.5-turbo': { input: 0.5, output: 1.5 },
  'claude-opus-4-5': { input: 15.0, output: 75.0 },
  'claude-sonnet-4-5': { input: 3.0, output: 15.0 },
  'claude-3-5-haiku-20241022': { input: 0.8, output: 4.0 },
  'claude-3-opus-20240229': { input: 15.0, output: 75.0 },
  'gemini-2.5-pro': { input: 1.25, output: 10.0 },
  'gemini-2.5-flash': { input: 0.3, output: 2.5 },
  'gemini-2.0-flash': { input: 0.1, output: 0.4 },
  'llama-3.3-70b-versatile': { input: 0.59, output: 0.79 },
  'llama-3.1-8b-instant': { input: 0.05, output: 0.08 },
};

function estimateCost(model, promptTokens, completionTokens) {
  var rates = COST_PER_1M[model];
  if (!rates) return null;
  var cost = (promptTokens / 1e6) * rates.input + (completionTokens / 1e6) * rates.output;
  return cost < 0.01 ? '<$0.01' : '$' + cost.toFixed(4);
}

function populateProviderSelect(selectEl, selected) {
  if (!selectEl) return;
  selectEl.innerHTML = '';
  PROVIDER_ORDER.forEach(function (p) {
    var opt = document.createElement('option');
    opt.value = p;
    opt.textContent = PROVIDER_LABELS[p] || p;
    selectEl.appendChild(opt);
  });
  if (selected) selectEl.value = selected;
}

function populateModelSelect(selectEl, provider) {
  if (!selectEl) return;
  selectEl.innerHTML = '';
  var models = MODEL_CATALOGUE[provider] || [];
  models.forEach(function (m) {
    var opt = document.createElement('option');
    opt.value = m;
    opt.textContent = prettyModel(m);
    selectEl.appendChild(opt);
  });
}

// BUG-03: XSS sanitization helper using DOMPurify
function safeParse(markdown) {
  var raw = (typeof marked !== 'undefined') ? marked.parse(markdown) : markdown;
  if (typeof DOMPurify !== 'undefined') {
    return DOMPurify.sanitize(raw, { USE_PROFILES: { html: true } });
  }
  var div = document.createElement('div');
  div.textContent = raw;
  return div.innerHTML;
}

/* ── 1. SettingsManager ── */

class SettingsManager {
  constructor() {
    this.keys = {};
    var self = this;
    PROVIDER_ORDER.forEach(function (p) {
      self.keys[p] = localStorage.getItem('octra_' + p + '_key') || '';
    });
    this.defaultProvider = localStorage.getItem('octra_default_provider') || 'openai';
    this.temperature = parseFloat(localStorage.getItem('octra_temperature') || '0.7');
    this.maxTokens = parseInt(localStorage.getItem('octra_max_tokens') || '4096');
    this.theme = localStorage.getItem('octra_theme') || 'dark';
    this.systemPrompt = localStorage.getItem('octra_system_prompt') || '';
    // Custom / local OpenAI-compatible endpoint
    this.customBaseURL = localStorage.getItem('octra_custom_base_url') || 'http://localhost:11434/v1';
    this.customModels = JSON.parse(localStorage.getItem('octra_custom_models') || '[]');
    if (this.customModels.length) MODEL_CATALOGUE.custom = this.customModels;
  }

  baseURLFor(provider) {
    return provider === 'custom' ? this.customBaseURL : undefined;
  }

  saveCustomEndpoint() {
    var base = (document.getElementById('custom-base-url') || {}).value || '';
    var modelsRaw = (document.getElementById('custom-models') || {}).value || '';
    var key = (document.getElementById('custom-key') || {}).value || '';
    this.customBaseURL = base.trim() || 'http://localhost:11434/v1';
    this.customModels = modelsRaw.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    this.keys.custom = key.trim();
    localStorage.setItem('octra_custom_base_url', this.customBaseURL);
    localStorage.setItem('octra_custom_models', JSON.stringify(this.customModels));
    localStorage.setItem('octra_custom_key', this.keys.custom);
    MODEL_CATALOGUE.custom = this.customModels;
    this.updateKeyStatus();
    this.updateConnectionStatus();
    app.showToast('Custom endpoint saved', 'success');
    var cp = document.getElementById('chat-provider');
    bindProviderModel('chat-provider', 'chat-model', cp ? cp.value : this.defaultProvider);
  }

  init() {
    var self = this;
    PROVIDER_ORDER.forEach(function (p) {
      var input = document.getElementById(p + '-key');
      if (input) input.value = self.keys[p];
    });
    var customBase = document.getElementById('custom-base-url');
    var customModels = document.getElementById('custom-models');
    var customKey = document.getElementById('custom-key');
    if (customBase) customBase.value = this.customBaseURL;
    if (customModels) customModels.value = (this.customModels || []).join(', ');
    if (customKey) customKey.value = this.keys.custom || '';
    var saveCustomBtn = document.getElementById('save-custom-btn');
    if (saveCustomBtn) saveCustomBtn.addEventListener('click', function () { self.saveCustomEndpoint(); });

    var defaultProviderSelect = document.getElementById('default-provider');
    var tempSlider = document.getElementById('temperature-slider');
    var tempValue = document.getElementById('temp-value');
    var maxTokensInput = document.getElementById('max-tokens-input');
    var systemPromptInput = document.getElementById('system-prompt-input');

    if (defaultProviderSelect) defaultProviderSelect.value = this.defaultProvider;
    if (tempSlider) tempSlider.value = this.temperature;
    if (tempValue) tempValue.textContent = this.temperature;
    if (maxTokensInput) maxTokensInput.value = this.maxTokens;
    if (systemPromptInput) systemPromptInput.value = this.systemPrompt;

    document.querySelectorAll('.save-key-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { self.saveKey(btn.dataset.provider); });
    });

    document.querySelectorAll('.toggle-visibility').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var input = document.getElementById(btn.dataset.target);
        if (!input) return;
        if (input.type === 'password') {
          input.type = 'text';
          btn.querySelector('i').className = 'fas fa-eye-slash';
        } else {
          input.type = 'password';
          btn.querySelector('i').className = 'fas fa-eye';
        }
      });
    });

    if (defaultProviderSelect) {
      defaultProviderSelect.addEventListener('change', function () {
        self.defaultProvider = defaultProviderSelect.value;
        localStorage.setItem('octra_default_provider', self.defaultProvider);
      });
    }
    if (tempSlider) {
      tempSlider.addEventListener('input', function () {
        self.temperature = parseFloat(tempSlider.value);
        localStorage.setItem('octra_temperature', self.temperature.toString());
        if (tempValue) tempValue.textContent = self.temperature;
      });
    }
    if (maxTokensInput) {
      maxTokensInput.addEventListener('change', function () {
        self.maxTokens = parseInt(maxTokensInput.value) || 4096;
        localStorage.setItem('octra_max_tokens', self.maxTokens.toString());
      });
    }
    if (systemPromptInput) {
      systemPromptInput.addEventListener('input', function () {
        self.systemPrompt = systemPromptInput.value;
        localStorage.setItem('octra_system_prompt', self.systemPrompt);
      });
    }
    document.querySelectorAll('.theme-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { self.applyTheme(btn.dataset.theme); });
    });
    var clearBtn = document.getElementById('clear-all-data');
    if (clearBtn) clearBtn.addEventListener('click', function () { self.clearAll(); });

    this.applyTheme(this.theme);
    this.updateKeyStatus();
    this.updateConnectionStatus();
  }

  saveKey(provider) {
    var input = document.getElementById(provider + '-key');
    if (!input) return;
    var key = input.value.trim();
    if (!key) { app.showToast('Please enter an API key', 'error'); return; }
    this.keys[provider] = key;
    localStorage.setItem('octra_' + provider + '_key', key);
    this.updateKeyStatus();
    this.updateConnectionStatus();
    app.showToast((PROVIDER_LABELS[provider] || provider) + ' API key saved!', 'success');
  }

  updateKeyStatus() {
    var self = this;
    PROVIDER_ORDER.forEach(function (p) {
      var statusEl = document.getElementById(p + '-status');
      if (!statusEl) return;
      var has = !!self.keys[p];
      statusEl.innerHTML = '<i class="fas fa-circle"></i> ' + (has ? 'Configured' : 'Not configured');
      statusEl.className = 'key-status ' + (has ? 'configured' : 'not-configured');
    });
  }

  configuredProviders() {
    var self = this;
    return PROVIDER_ORDER.filter(function (p) { return !!self.keys[p]; });
  }

  updateConnectionStatus() {
    var el = document.getElementById('connection-status');
    if (!el) return;
    var dot = el.querySelector('.status-dot');
    var text = el.querySelector('.status-text');
    var configured = this.configuredProviders();
    if (configured.length) {
      dot.classList.add('connected');
      text.textContent = configured.map(function (p) { return PROVIDER_LABELS[p]; }).join(' & ') + ': Connected';
    } else {
      dot.classList.remove('connected');
      text.textContent = 'No provider connected';
    }
  }

  getActiveKey(provider) {
    return this.keys[provider] || '';
  }

  applyTheme(theme) {
    this.theme = theme;
    localStorage.setItem('octra_theme', theme);
    document.documentElement.setAttribute('data-theme', theme);
    document.querySelectorAll('.theme-btn').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.theme === theme);
    });
  }

  clearAll() {
    if (!confirm('This will delete all your API keys and settings. Are you sure?')) return;
    var self = this;
    PROVIDER_ORDER.forEach(function (p) {
      localStorage.removeItem('octra_' + p + '_key');
      self.keys[p] = '';
      var input = document.getElementById(p + '-key');
      if (input) input.value = '';
    });
    ['octra_default_provider', 'octra_temperature', 'octra_max_tokens', 'octra_theme', 'octra_chat_history', 'octra_stats', 'octra_system_prompt'].forEach(function (k) {
      localStorage.removeItem(k);
    });
    this.systemPrompt = '';
    var systemPromptInput = document.getElementById('system-prompt-input');
    if (systemPromptInput) systemPromptInput.value = '';
    this.updateKeyStatus();
    this.updateConnectionStatus();
    app.showToast('All data cleared', 'info');
  }
}

/* ── Provider/model selector binding shared by Chat, Autopilot, CodeLab ── */

function bindProviderModel(providerId, modelId, defaultProvider) {
  var providerSelect = document.getElementById(providerId);
  var modelSelect = document.getElementById(modelId);
  if (!providerSelect || !modelSelect) return;
  populateProviderSelect(providerSelect, defaultProvider);
  var update = function () { populateModelSelect(modelSelect, providerSelect.value); };
  providerSelect.addEventListener('change', update);
  update();
}

/* ── 2. ChatManager ── */

class ChatManager {
  constructor() {
    this.messages = [];
    this.isLoading = false;
    this.pendingImages = [];
    this.activePersona = null;
  }

  init() {
    var self = this;
    var sendBtn = document.getElementById('send-btn');
    if (sendBtn) sendBtn.addEventListener('click', function () { self.sendMessage(); });

    var chatInput = document.getElementById('chat-input');
    if (chatInput) {
      chatInput.addEventListener('keydown', function (e) {
        if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); self.sendMessage(); }
      });
      chatInput.addEventListener('input', function () {
        chatInput.style.height = 'auto';
        chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
      });
    }

    var clearChatBtn = document.getElementById('clear-chat-btn');
    if (clearChatBtn) clearChatBtn.addEventListener('click', function () { self.clearChat(); });
    var exportChatBtn = document.getElementById('export-chat-btn');
    if (exportChatBtn) exportChatBtn.addEventListener('click', function () { self.exportChat(); });

    // Vision: attach images
    var attachBtn = document.getElementById('attach-image-btn');
    var imageInput = document.getElementById('chat-image-input');
    if (attachBtn && imageInput) {
      attachBtn.addEventListener('click', function () { imageInput.click(); });
      imageInput.addEventListener('change', function () { self.handleImageFiles(imageInput.files); imageInput.value = ''; });
    }

    // Persona picker
    var personaSel = document.getElementById('chat-persona');
    if (personaSel) {
      personaSel.addEventListener('change', function () { self.applyPersona(personaSel.value); });
    }

    bindProviderModel('chat-provider', 'chat-model', app.settings.defaultProvider);
  }

  handleImageFiles(files) {
    var self = this;
    Array.prototype.forEach.call(files || [], function (file) {
      if (!file.type || file.type.indexOf('image/') !== 0) return;
      var reader = new FileReader();
      reader.onload = function () {
        self.pendingImages.push({ name: file.name, dataUrl: String(reader.result || '') });
        self.renderImageStrip();
      };
      reader.readAsDataURL(file);
    });
  }

  renderImageStrip() {
    var strip = document.getElementById('chat-image-strip');
    if (!strip) return;
    if (!this.pendingImages.length) { strip.style.display = 'none'; strip.innerHTML = ''; return; }
    var self = this;
    strip.style.display = 'flex';
    strip.innerHTML = '';
    this.pendingImages.forEach(function (img, idx) {
      var chip = document.createElement('span');
      chip.className = 'image-chip';
      chip.innerHTML = '<img src="' + img.dataUrl + '" alt=""> ';
      var x = document.createElement('button');
      x.className = 'icon-btn';
      x.innerHTML = '<i class="fas fa-times"></i>';
      x.addEventListener('click', function () { self.pendingImages.splice(idx, 1); self.renderImageStrip(); });
      chip.appendChild(x);
      strip.appendChild(chip);
    });
  }

  applyPersona(personaId) {
    if (!personaId) { this.activePersona = null; return; }
    var p = app.personas ? app.personas.byId(personaId) : null;
    if (!p) { this.activePersona = null; return; }
    this.activePersona = p;
    var providerSel = document.getElementById('chat-provider');
    var modelSel = document.getElementById('chat-model');
    if (p.provider && providerSel) { providerSel.value = p.provider; populateModelSelect(modelSel, p.provider); }
    if (p.model && modelSel) modelSel.value = p.model;
    app.showToast('Persona "' + p.name + '" applied', 'info');
  }

  async apiErrorMessage(response) {
    var body = {};
    try { body = await response.json(); } catch { /* not json */ }
    var serverMsg = body.error || body.message || '';
    if (response.status === 429) return 'Rate limit exceeded. Please wait and try again.' + (serverMsg ? ' (' + serverMsg + ')' : '');
    if (response.status === 401) return 'Invalid API key. Please check your key in Settings.';
    if (response.status === 403) return 'Access forbidden. Check your API key permissions.';
    if (response.status === 500) return 'Server error. Please try again in a moment.' + (serverMsg ? ' (' + serverMsg + ')' : '');
    if (response.status === 503) return 'AI service temporarily unavailable. Please try again.';
    return 'API error (' + response.status + '): ' + (serverMsg || response.statusText);
  }

  currentMode() {
    var modeSelect = document.getElementById('chat-mode');
    return modeSelect ? modeSelect.value : 'chat';
  }

  async sendMessage() {
    if (this.isLoading) return;
    var input = document.getElementById('chat-input');
    if (!input) return;
    var text = input.value.trim();
    if (!text) return;

    var providerSelect = document.getElementById('chat-provider');
    var modelSelect = document.getElementById('chat-model');
    var provider = providerSelect ? providerSelect.value : 'openai';
    var model = modelSelect ? modelSelect.value : 'gpt-4o';
    var apiKey = app.settings.getActiveKey(provider);
    var mode = this.currentMode();

    // Custom/local endpoints may legitimately need no key.
    if (!apiKey && provider !== 'custom') {
      app.showToast('Please configure your ' + (PROVIDER_LABELS[provider] || provider) + ' API key in Settings', 'error');
      return;
    }
    if (!apiKey) apiKey = 'none';

    var images = this.pendingImages.map(function (i) { return i.dataUrl; });
    this.addMessage('user', text, images);
    this.pendingImages = [];
    this.renderImageStrip();
    input.value = '';
    input.style.height = 'auto';
    this.setLoading(true);

    if (mode === 'agent') {
      await this.runAgentMode(provider, apiKey, model, text);
    } else if (mode === 'rag') {
      await this.runRagMode(provider, apiKey, model);
    } else {
      await this.runStreamMode(provider, apiKey, model);
    }

    this.setLoading(false);
    this.saveHistory();
  }

  // Persona system prompt overrides the global one when a persona is active.
  effectiveSystemPrompt() {
    if (this.activePersona && this.activePersona.systemPrompt) return this.activePersona.systemPrompt;
    return app.settings.systemPrompt || undefined;
  }

  async runStreamMode(provider, apiKey, model) {
    var assistantMsgEl = this.createStreamingMessageEl();
    var self = this;
    var accumulated = '';
    try {
      var response = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: provider, apiKey: apiKey, model: model, messages: this.messages,
          temperature: app.settings.temperature, maxTokens: app.settings.maxTokens,
          systemPrompt: this.effectiveSystemPrompt(),
          baseURL: app.settings.baseURLFor(provider),
        }),
      });
      if (!response.ok) {
        var errMsg = await this.apiErrorMessage(response);
        this.finishStreamingMessage(assistantMsgEl, 'Error: ' + errMsg);
        app.showToast(errMsg, 'error');
        return;
      }
      await this.consumeSSE(response, function (evtType, evtData) {
        if (evtType === 'delta') {
          accumulated += evtData.content;
          self.updateStreamingMessage(assistantMsgEl, accumulated);
        } else if (evtType === 'done') {
          self.finishStreamingMessage(assistantMsgEl, accumulated);
          self.messages.push({ role: 'assistant', content: accumulated });
          var usage = evtData.usage || {};
          app.updateStats('messages', 1);
          app.updateStats('tokens', usage.total_tokens || 0);
          if (usage.total_tokens) self.showUsageInfo(usage, estimateCost(model, usage.prompt_tokens || 0, usage.completion_tokens || 0));
        } else if (evtType === 'error') {
          self.finishStreamingMessage(assistantMsgEl, 'Error: ' + (evtData.error || 'Unknown error'));
          app.showToast(evtData.error || 'Streaming error', 'error');
        }
      });
    } catch (err) {
      this.finishStreamingMessage(assistantMsgEl, 'Connection error: ' + this.netErr(err));
      app.showToast(this.netErr(err), 'error');
    }
  }

  async runRagMode(provider, apiKey, model) {
    var el = this.createStreamingMessageEl();
    try {
      var ragBody = { provider: provider, apiKey: apiKey, model: model, messages: this.messages, temperature: app.settings.temperature, maxTokens: app.settings.maxTokens, baseURL: app.settings.baseURLFor(provider) };
      // Optional semantic retrieval using a configured embedding provider.
      if (app.knowledge && app.knowledge.semanticEnabled()) {
        var ep = app.knowledge.embedProvider();
        var ek = app.settings.getActiveKey(ep);
        if (ek) { ragBody.embedProvider = ep; ragBody.embedApiKey = ek; }
      }
      var response = await fetch('/api/rag/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ragBody),
      });
      var data = await response.json();
      if (!response.ok || !data.success) {
        this.finishStreamingMessage(el, 'Error: ' + (data.error || 'request failed'));
        app.showToast(data.error || 'RAG request failed', 'error');
        return;
      }
      var content = data.message.content;
      if (data.sources && data.sources.length) {
        content += '\n\n---\n*Grounded in ' + data.sources.length + ' source(s): ' + data.sources.map(function (s) { return s.docName; }).join(', ') + '*';
      }
      this.finishStreamingMessage(el, content);
      this.messages.push({ role: 'assistant', content: data.message.content });
      app.updateStats('messages', 1);
      if (data.usage) app.updateStats('tokens', data.usage.total_tokens || 0);
    } catch (err) {
      this.finishStreamingMessage(el, 'Connection error: ' + this.netErr(err));
      app.showToast(this.netErr(err), 'error');
    }
  }

  async runAgentMode(provider, apiKey, model, query) {
    var el = this.createStreamingMessageEl();
    var self = this;
    var log = '';
    try {
      var response = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: provider, apiKey: apiKey, model: model, query: query, temperature: app.settings.temperature, maxTokens: app.settings.maxTokens, baseURL: app.settings.baseURLFor(provider) }),
      });
      if (!response.ok) {
        var errMsg = await this.apiErrorMessage(response);
        this.finishStreamingMessage(el, 'Error: ' + errMsg);
        app.showToast(errMsg, 'error');
        return;
      }
      await this.consumeSSE(response, function (evtType, evtData) {
        if (evtType === 'tool_call') {
          log += '🛠️ **' + evtData.tool + '** `' + JSON.stringify(evtData.args || {}) + '`\n\n';
          self.updateStreamingMessage(el, log);
        } else if (evtType === 'tool_result') {
          log += '↳ ' + String(evtData.observation).slice(0, 240) + '\n\n';
          self.updateStreamingMessage(el, log);
        } else if (evtType === 'done') {
          var answer = (evtData.answer || '') + (log ? '\n\n---\n<sub>' + (evtData.steps ? evtData.steps.length : 0) + ' tool step(s)</sub>' : '');
          self.finishStreamingMessage(el, answer || log || '(no answer)');
          self.messages.push({ role: 'assistant', content: evtData.answer || '' });
          app.updateStats('messages', 1);
          if (evtData.usage) app.updateStats('tokens', evtData.usage.total_tokens || 0);
        } else if (evtType === 'error') {
          self.finishStreamingMessage(el, 'Error: ' + (evtData.error || 'agent error'));
          app.showToast(evtData.error || 'Agent error', 'error');
        }
      });
    } catch (err) {
      this.finishStreamingMessage(el, 'Connection error: ' + this.netErr(err));
      app.showToast(this.netErr(err), 'error');
    }
  }

  netErr(err) {
    if (err.name === 'AbortError') return 'Request timed out. Please try again.';
    if (err.message && err.message.includes('fetch')) return 'Network error — check your connection.';
    return err.message || 'Unexpected error';
  }

  // Generic SSE reader: invokes cb(eventType, data) per event.
  async consumeSSE(response, cb) {
    var reader = response.body.getReader();
    var decoder = new TextDecoder();
    var buffer = '';
    while (true) {
      var chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      var parts = buffer.split('\n\n');
      buffer = parts.pop();
      for (var i = 0; i < parts.length; i++) {
        var part = parts[i].trim();
        if (!part) continue;
        var eventMatch = part.match(/^event: (\w+)/m);
        var dataMatch = part.match(/^data: (.+)/m);
        if (!eventMatch || !dataMatch) continue;
        var evtData;
        try { evtData = JSON.parse(dataMatch[1]); } catch { continue; }
        cb(eventMatch[1], evtData);
      }
    }
  }

  createStreamingMessageEl() {
    var container = document.getElementById('chat-messages');
    if (!container) return null;
    var welcome = container.querySelector('.welcome-message');
    if (welcome) welcome.remove();
    var msgDiv = document.createElement('div');
    msgDiv.className = 'message assistant streaming';
    var avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    avatar.innerHTML = '<i class="fas fa-robot"></i>';
    var contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    contentDiv.innerHTML = '<span class="cursor-blink">|</span>';
    msgDiv.appendChild(avatar);
    msgDiv.appendChild(contentDiv);
    container.appendChild(msgDiv);
    container.scrollTop = container.scrollHeight;
    return msgDiv;
  }

  updateStreamingMessage(el, text) {
    if (!el) return;
    var contentDiv = el.querySelector('.message-content');
    if (!contentDiv) return;
    contentDiv.innerHTML = safeParse(text) + '<span class="cursor-blink">|</span>';
    var container = document.getElementById('chat-messages');
    if (container) container.scrollTop = container.scrollHeight;
  }

  finishStreamingMessage(el, text) {
    if (!el) return;
    var contentDiv = el.querySelector('.message-content');
    if (!contentDiv) return;
    el.classList.remove('streaming');
    contentDiv.innerHTML = safeParse(text);
    this._decorateCode(contentDiv);
    var container = document.getElementById('chat-messages');
    if (container) container.scrollTop = container.scrollHeight;
  }

  _decorateCode(contentDiv) {
    contentDiv.querySelectorAll('pre code').forEach(function (block) {
      if (typeof hljs !== 'undefined') hljs.highlightElement(block);
      var pre = block.parentElement;
      pre.style.position = 'relative';
      var copyBtn = document.createElement('button');
      copyBtn.className = 'code-copy-btn';
      copyBtn.textContent = 'Copy';
      copyBtn.onclick = function () {
        navigator.clipboard.writeText(block.textContent);
        copyBtn.textContent = 'Copied!';
        setTimeout(function () { copyBtn.textContent = 'Copy'; }, 1500);
      };
      pre.appendChild(copyBtn);
    });
  }

  showUsageInfo(usage, cost) {
    var container = document.getElementById('chat-messages');
    if (!container) return;
    var infoEl = document.createElement('div');
    infoEl.className = 'usage-info';
    var parts = ['Tokens: ' + (usage.total_tokens || 0)];
    if (cost) parts.push('Est. cost: ' + cost);
    infoEl.textContent = parts.join(' | ');
    container.appendChild(infoEl);
    container.scrollTop = container.scrollHeight;
  }

  addMessage(role, content, images) {
    var msg = { role: role, content: content };
    if (images && images.length) msg.images = images;
    this.messages.push(msg);
    var container = document.getElementById('chat-messages');
    if (!container) return;
    var welcome = container.querySelector('.welcome-message');
    if (welcome) welcome.remove();
    var msgDiv = document.createElement('div');
    msgDiv.className = 'message ' + role;
    var avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    avatar.innerHTML = role === 'user' ? '<i class="fas fa-user"></i>' : '<i class="fas fa-robot"></i>';
    var contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    if (role === 'assistant') {
      contentDiv.innerHTML = safeParse(content);
      this._decorateCode(contentDiv);
    } else {
      contentDiv.textContent = content;
      if (images && images.length) {
        var gallery = document.createElement('div');
        gallery.className = 'msg-images';
        images.forEach(function (src) {
          var im = document.createElement('img');
          im.src = src;
          im.alt = 'attached image';
          gallery.appendChild(im);
        });
        contentDiv.appendChild(gallery);
      }
    }
    msgDiv.appendChild(avatar);
    msgDiv.appendChild(contentDiv);
    container.appendChild(msgDiv);
    container.scrollTop = container.scrollHeight;
  }

  setLoading(loading) {
    this.isLoading = loading;
    var indicator = document.getElementById('typing-indicator');
    var sendBtn = document.getElementById('send-btn');
    if (indicator) indicator.style.display = loading ? 'flex' : 'none';
    if (sendBtn) sendBtn.disabled = loading;
  }

  clearChat() {
    if (this.messages.length === 0) return;
    if (!confirm('Clear all chat messages?')) return;
    this.messages = [];
    var container = document.getElementById('chat-messages');
    if (container) {
      container.innerHTML = '<div class="welcome-message"><div class="welcome-icon"><i class="fas fa-robot"></i></div><h3>Octra Network AI Agent</h3><p>Hello! I\'m your AI assistant. Enter your API key in Settings, then ask me anything.</p></div>';
    }
    localStorage.removeItem('octra_chat_history');
    app.showToast('Chat cleared', 'info');
  }

  exportChat() {
    if (this.messages.length === 0) { app.showToast('No messages to export', 'warning'); return; }
    var data = JSON.stringify({
      exported: new Date().toISOString(),
      model: document.getElementById('chat-model') ? document.getElementById('chat-model').value : 'unknown',
      messages: this.messages,
    }, null, 2);
    var blob = new Blob([data], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'octra-chat-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    app.showToast('Chat exported as JSON', 'success');
  }

  saveHistory() {
    localStorage.setItem('octra_chat_history', JSON.stringify(this.messages.slice(-50)));
  }

  loadHistory() {
    var saved = localStorage.getItem('octra_chat_history');
    if (!saved) return;
    try {
      var msgs = JSON.parse(saved);
      if (msgs && msgs.length > 0) {
        var container = document.getElementById('chat-messages');
        if (container) {
          this.messages = [];
          container.innerHTML = '';
          var self = this;
          msgs.forEach(function (m) { self.addMessage(m.role, m.content); });
        }
      }
    } catch { /* ignore corrupt data */ }
  }
}

/* ── 3. AutopilotEngine (multi-agent) ── */

class AutopilotEngine {
  constructor() {
    this.isRunning = false;
    this.currentRunId = null;
  }

  init() {
    var self = this;
    var startBtn = document.getElementById('autopilot-start');
    if (startBtn) startBtn.addEventListener('click', function () { self.start(); });
    var stopBtn = document.getElementById('autopilot-stop');
    if (stopBtn) stopBtn.addEventListener('click', function () { self.stop(); });
    bindProviderModel('autopilot-provider', 'autopilot-model', app.settings.defaultProvider);
  }

  async start() {
    var goalInput = document.getElementById('autopilot-goal');
    if (!goalInput) return;
    var goal = goalInput.value.trim();
    if (!goal) { app.showToast('Please enter a goal', 'error'); return; }

    var providerSelect = document.getElementById('autopilot-provider');
    var modelSelect = document.getElementById('autopilot-model');
    var provider = providerSelect ? providerSelect.value : 'openai';
    var model = modelSelect ? modelSelect.value : 'gpt-4o';
    var apiKey = app.settings.getActiveKey(provider);
    if (!apiKey && provider !== 'custom') {
      app.showToast('Please configure your ' + (PROVIDER_LABELS[provider] || provider) + ' API key in Settings', 'error');
      return;
    }
    if (!apiKey) apiKey = 'none';

    var useTools = !!(document.getElementById('autopilot-tools') || {}).checked;
    var selfCritique = !!(document.getElementById('autopilot-critique') || { checked: true }).checked;

    this.isRunning = true;
    var startBtn = document.getElementById('autopilot-start');
    var stopBtn = document.getElementById('autopilot-stop');
    var progressSection = document.getElementById('autopilot-progress');
    var resultsSection = document.getElementById('autopilot-results');
    var stepsContainer = document.getElementById('autopilot-steps');
    var progressBar = document.getElementById('autopilot-progress-bar');
    if (startBtn) startBtn.style.display = 'none';
    if (stopBtn) stopBtn.style.display = 'inline-flex';
    if (progressSection) progressSection.style.display = 'block';
    if (resultsSection) resultsSection.style.display = 'none';
    if (stepsContainer) stepsContainer.innerHTML = '';
    if (progressBar) progressBar.style.width = '0%';

    app.showToast('Autopilot launched!', 'info');
    app.addActivity('Autopilot started: ' + goal.substring(0, 50) + '...');

    var self = this;
    var planSteps = [];
    var stepElements = {};
    var completedCount = 0;

    try {
      var response = await fetch('/api/autopilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: provider, apiKey: apiKey, model: model, goal: goal,
          temperature: app.settings.temperature, maxTokens: app.settings.maxTokens,
          useTools: useTools, selfCritique: selfCritique,
          baseURL: app.settings.baseURLFor(provider),
        }),
      });
      if (!response.ok) {
        app.showToast('Autopilot failed to start (' + response.status + ')', 'error');
        this._resetUI();
        return;
      }
      await app.chat.consumeSSE(response, function (evtType, evtData) {
        if (evtType === 'run_id') {
          self.currentRunId = evtData.runId;
        } else if (evtType === 'plan') {
          planSteps = evtData.steps;
          if (stepsContainer) {
            stepsContainer.innerHTML = '';
            stepElements = {};
            planSteps.forEach(function (stepText, idx) {
              var el = self._createStepEl(idx, stepText, 'pending');
              stepElements[idx] = el;
              stepsContainer.appendChild(el);
            });
          }
        } else if (evtType === 'step_start') {
          var el1 = stepElements[evtData.index];
          if (el1) self._updateStepEl(el1, 'running', null);
        } else if (evtType === 'critique') {
          var elc = stepElements[evtData.index];
          if (elc && !evtData.pass) self._badge(elc, '🔁 revising');
        } else if (evtType === 'replan') {
          app.showToast('Autopilot replanning: ' + (evtData.reason || ''), 'info');
        } else if (evtType === 'step_done') {
          completedCount++;
          var el2 = stepElements[evtData.index];
          if (el2) self._updateStepEl(el2, evtData.status, evtData.result, evtData.toolSteps);
          var pct = planSteps.length ? (completedCount / planSteps.length) * 100 : 0;
          if (progressBar) progressBar.style.width = Math.min(100, pct) + '%';
        } else if (evtType === 'budget') {
          app.showToast(evtData.message || 'Token budget reached', 'warning');
        } else if (evtType === 'complete') {
          if (progressBar) progressBar.style.width = '100%';
          if (resultsSection) resultsSection.style.display = 'block';
          self._renderResults(goal, evtData);
          app.updateStats('tasks', 1);
          if (evtData.usage) app.updateStats('tokens', evtData.usage.total_tokens || 0);
          app.showToast('Autopilot complete!', 'success');
          app.addActivity('Autopilot completed: ' + completedCount + ' steps');
        } else if (evtType === 'cancelled') {
          app.showToast('Autopilot stopped', 'warning');
          app.addActivity('Autopilot cancelled');
        } else if (evtType === 'error') {
          app.showToast('Autopilot error: ' + (evtData.error || 'Unknown'), 'error');
        }
      });
    } catch (err) {
      if (!(err.message || '').includes('abort')) app.showToast('Autopilot error: ' + err.message, 'error');
    }
    self._resetUI();
  }

  _renderResults(goal, evtData) {
    var output = document.getElementById('autopilot-output');
    if (!output) return;
    var completedSteps = evtData.steps.filter(function (s) { return s.status === 'completed' || s.status === 'completed_with_warnings'; }).length;
    var html = '<strong>Goal:</strong> ' + this._esc(goal) + '<br><br>';
    html += '<strong>Completed:</strong> ' + completedSteps + '/' + evtData.steps.length + ' steps';
    if (evtData.replanned) html += ' (replanned once)';
    html += '<br><br>';
    var self = this;
    evtData.steps.forEach(function (s, idx) {
      html += '<strong>Step ' + (idx + 1) + ' [' + s.status + ']:</strong> ' + self._esc(s.step) + '<br>' + safeParse(s.result || '') + '<br>';
    });
    output.innerHTML = html;
  }

  async stop() {
    if (this.currentRunId) {
      try {
        await fetch('/api/autopilot/stop', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ runId: this.currentRunId }),
        });
      } catch { /* ignore */ }
      this.currentRunId = null;
    }
    this._resetUI();
    app.showToast('Autopilot stop requested', 'warning');
  }

  _resetUI() {
    this.isRunning = false;
    var startBtn = document.getElementById('autopilot-start');
    var stopBtn = document.getElementById('autopilot-stop');
    if (startBtn) startBtn.style.display = 'inline-flex';
    if (stopBtn) stopBtn.style.display = 'none';
  }

  _esc(str) {
    var d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  _badge(el, label) {
    var title = el.querySelector('.step-title');
    if (title && title.textContent.indexOf(label) === -1) title.textContent += '  ' + label;
  }

  _createStepEl(index, stepText, status) {
    var el = document.createElement('div');
    el.className = 'step-item ' + status;
    el.dataset.index = index;
    var iconDiv = document.createElement('div');
    iconDiv.className = 'step-icon';
    iconDiv.innerHTML = '<i class="fas fa-clock"></i>';
    var contentDiv = document.createElement('div');
    contentDiv.className = 'step-content';
    var titleDiv = document.createElement('div');
    titleDiv.className = 'step-title';
    titleDiv.textContent = 'Step ' + (index + 1) + ': ' + stepText;
    var resultDiv = document.createElement('div');
    resultDiv.className = 'step-result';
    contentDiv.appendChild(titleDiv);
    contentDiv.appendChild(resultDiv);
    el.appendChild(iconDiv);
    el.appendChild(contentDiv);
    return el;
  }

  _updateStepEl(el, status, result, toolSteps) {
    el.className = 'step-item ' + status;
    var iconDiv = el.querySelector('.step-icon');
    var resultDiv = el.querySelector('.step-result');
    if (iconDiv) {
      var iconClass = status === 'running' ? 'fa-spinner fa-spin'
        : (status === 'completed' ? 'fa-check'
          : (status === 'completed_with_warnings' ? 'fa-triangle-exclamation'
            : (status === 'failed' ? 'fa-times' : 'fa-clock')));
      iconDiv.innerHTML = '<i class="fas ' + iconClass + '"></i>';
    }
    if (resultDiv && result !== null && result !== undefined) {
      var html = safeParse(result);
      if (toolSteps && toolSteps.length) {
        html += '<div class="tool-trace">' + toolSteps.map(function (t) {
          return '🛠️ ' + t.tool + (t.ok ? '' : ' (error)');
        }).join(' · ') + '</div>';
      }
      resultDiv.innerHTML = html;
    }
  }
}

/* ── 4. CodeLab ── */

class CodeLab {
  constructor() { this.lastOutput = ''; }

  init() {
    var self = this;
    document.querySelectorAll('.codelab-actions .action-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { self.handleAction(btn.dataset.action); });
    });
    var copyBtn = document.getElementById('copy-output-btn');
    if (copyBtn) copyBtn.addEventListener('click', function () { self.copyOutput(); });
    bindProviderModel('codelab-provider', 'codelab-model', app.settings.defaultProvider);
  }

  async handleAction(action) {
    var inputEl = document.getElementById('codelab-input');
    if (!inputEl) return;
    var input = inputEl.value.trim();
    if (!input) { app.showToast('Please enter code or a description', 'error'); return; }

    var providerSelect = document.getElementById('codelab-provider');
    var modelSelect = document.getElementById('codelab-model');
    var provider = providerSelect ? providerSelect.value : app.settings.defaultProvider;
    var model = modelSelect ? modelSelect.value : 'gpt-4o';
    var apiKey = app.settings.getActiveKey(provider);
    if (!apiKey && provider !== 'custom') { app.showToast('Please configure an API key in Settings', 'error'); return; }
    if (!apiKey) apiKey = 'none';

    var outputEl = document.getElementById('codelab-output');
    var copyBtn = document.getElementById('copy-output-btn');
    if (outputEl) outputEl.innerHTML = '<div class="empty-state"><div class="spinner"></div><p>Processing...</p></div>';
    if (copyBtn) copyBtn.style.display = 'none';

    try {
      var response = await fetch('/api/analyze', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: provider, apiKey: apiKey, model: model, code: input, action: action, prompt: input,
          temperature: app.settings.temperature, maxTokens: app.settings.maxTokens,
          baseURL: app.settings.baseURLFor(provider),
        }),
      });
      var data = await response.json();
      if (data.success) {
        this.lastOutput = data.result;
        if (outputEl) {
          outputEl.innerHTML = safeParse(data.result);
          outputEl.querySelectorAll('pre code').forEach(function (block) {
            if (typeof hljs !== 'undefined') hljs.highlightElement(block);
          });
        }
        if (copyBtn) copyBtn.style.display = 'flex';
        app.updateStats('messages', 1);
        app.addActivity('Code ' + action + ': completed');
        if (data.usage && data.usage.total_tokens) {
          var cost = estimateCost(model, data.usage.prompt_tokens || 0, data.usage.completion_tokens || 0);
          app.showToast('Tokens: ' + data.usage.total_tokens + (cost ? ' | Est. cost: ' + cost : ''), 'info');
        }
      } else {
        if (outputEl) outputEl.innerHTML = '<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>Error: ' + (data.error || 'Unknown error') + '</p></div>';
        app.showToast('Code operation failed: ' + (data.error || 'Unknown error'), 'error');
      }
    } catch (err) {
      if (outputEl) outputEl.innerHTML = '<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>Error: ' + err.message + '</p></div>';
      app.showToast(err.message || 'Network error', 'error');
    }
  }

  copyOutput() {
    if (this.lastOutput) {
      navigator.clipboard.writeText(this.lastOutput);
      app.showToast('Copied to clipboard', 'success');
    }
  }
}

/* ── 5. KnowledgeManager (RAG) ── */

class KnowledgeManager {
  init() {
    var self = this;
    var addBtn = document.getElementById('rag-add-btn');
    if (addBtn) addBtn.addEventListener('click', function () { self.addDoc(); });
    var fileInput = document.getElementById('rag-file');
    if (fileInput) {
      fileInput.addEventListener('change', function () {
        var file = fileInput.files && fileInput.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function () {
          var nameEl = document.getElementById('rag-doc-name');
          var textEl = document.getElementById('rag-doc-text');
          if (nameEl && !nameEl.value) nameEl.value = file.name;
          if (textEl) textEl.value = String(reader.result || '');
        };
        reader.readAsText(file);
      });
    }
    var semantic = document.getElementById('rag-semantic');
    if (semantic) {
      semantic.checked = localStorage.getItem('octra_rag_semantic') === '1';
      semantic.addEventListener('change', function () {
        localStorage.setItem('octra_rag_semantic', semantic.checked ? '1' : '0');
      });
    }
    var embedBtn = document.getElementById('rag-embed-btn');
    if (embedBtn) embedBtn.addEventListener('click', function () { self.embedNow(); });
    this.refresh();
  }

  semanticEnabled() {
    var el = document.getElementById('rag-semantic');
    return !!(el && el.checked);
  }

  embedProvider() {
    var el = document.getElementById('rag-embed-provider');
    return el ? el.value : 'openai';
  }

  async embedNow() {
    var provider = this.embedProvider();
    var apiKey = app.settings.getActiveKey(provider);
    if (!apiKey) { app.showToast('Configure your ' + (PROVIDER_LABELS[provider] || provider) + ' key first', 'error'); return; }
    app.showToast('Embedding documents...', 'info');
    try {
      var res = await fetch('/api/rag/embed', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: provider, apiKey: apiKey, baseURL: app.settings.baseURLFor(provider) }),
      });
      var data = await res.json();
      if (data.success) app.showToast('Embedded ' + data.embedded + ' chunk(s)', 'success');
      else app.showToast(data.error || 'Embedding failed', 'error');
    } catch (err) {
      app.showToast(err.message || 'Network error', 'error');
    }
  }

  async addDoc() {
    var nameEl = document.getElementById('rag-doc-name');
    var textEl = document.getElementById('rag-doc-text');
    var name = nameEl ? nameEl.value.trim() : '';
    var text = textEl ? textEl.value.trim() : '';
    if (!name || !text) { app.showToast('Provide a name and document text', 'error'); return; }
    try {
      var res = await fetch('/api/rag/documents', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name, text: text }),
      });
      var data = await res.json();
      if (data.success) {
        app.showToast('Indexed "' + name + '" (' + data.document.chunks + ' chunks)', 'success');
        if (nameEl) nameEl.value = '';
        if (textEl) textEl.value = '';
        this.refresh();
      } else {
        app.showToast(data.error || 'Failed to add document', 'error');
      }
    } catch (err) {
      app.showToast(err.message || 'Network error', 'error');
    }
  }

  async refresh() {
    var list = document.getElementById('rag-doc-list');
    if (!list) return;
    try {
      var data = await (await fetch('/api/rag/documents')).json();
      if (!data.documents || !data.documents.length) {
        list.innerHTML = '<div class="empty-state"><i class="fas fa-inbox"></i><p>No documents yet. Add one above, then ask questions in Chat with mode set to Knowledge.</p></div>';
        return;
      }
      var self = this;
      list.innerHTML = '';
      data.documents.forEach(function (doc) {
        var row = document.createElement('div');
        row.className = 'activity-item';
        row.innerHTML = '<i class="fas fa-file-lines"></i><span>' + self._esc(doc.name) + ' <small>(' + doc.chunks + ' chunks)</small></span>';
        var del = document.createElement('button');
        del.className = 'icon-btn';
        del.innerHTML = '<i class="fas fa-trash"></i>';
        del.title = 'Remove';
        del.addEventListener('click', function () { self.removeDoc(doc.id); });
        row.appendChild(del);
        list.appendChild(row);
      });
    } catch { /* ignore */ }
  }

  async removeDoc(id) {
    try {
      await fetch('/api/rag/documents/' + encodeURIComponent(id), { method: 'DELETE' });
      app.showToast('Document removed', 'info');
      this.refresh();
    } catch (err) {
      app.showToast(err.message || 'Failed to remove', 'error');
    }
  }

  _esc(str) {
    var d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }
}

/* ── 6. PersonaManager ── */

class PersonaManager {
  constructor() { this.personas = []; }

  init() {
    var self = this;
    var createBtn = document.getElementById('persona-create-btn');
    if (createBtn) createBtn.addEventListener('click', function () { self.create(); });
    this.refresh();
  }

  byId(id) {
    return this.personas.find(function (p) { return p.id === id; }) || null;
  }

  async refresh() {
    try {
      var data = await (await fetch('/api/personas')).json();
      this.personas = data.personas || [];
    } catch { this.personas = []; }
    this.renderList();
    this.renderPicker();
  }

  renderPicker() {
    var sel = document.getElementById('chat-persona');
    if (!sel) return;
    var current = sel.value;
    sel.innerHTML = '<option value="">No persona</option>';
    this.personas.forEach(function (p) {
      var opt = document.createElement('option');
      opt.value = p.id; opt.textContent = p.name;
      sel.appendChild(opt);
    });
    sel.value = current;
  }

  renderList() {
    var list = document.getElementById('persona-list');
    if (!list) return;
    if (!this.personas.length) {
      list.innerHTML = '<div class="empty-state"><i class="fas fa-masks-theater"></i><p>No personas yet.</p></div>';
      return;
    }
    var self = this;
    list.innerHTML = '';
    this.personas.forEach(function (p) {
      var row = document.createElement('div');
      row.className = 'activity-item';
      row.innerHTML = '<i class="fas fa-masks-theater"></i><span>' + self._esc(p.name) + (p.model ? ' <small>(' + self._esc(p.model) + ')</small>' : '') + '</span>';
      var del = document.createElement('button');
      del.className = 'icon-btn';
      del.innerHTML = '<i class="fas fa-trash"></i>';
      del.title = 'Delete persona';
      del.addEventListener('click', function () { self.remove(p.id); });
      row.appendChild(del);
      list.appendChild(row);
    });
  }

  async create() {
    var nameEl = document.getElementById('persona-name');
    var promptEl = document.getElementById('persona-prompt');
    var name = nameEl ? nameEl.value.trim() : '';
    var systemPrompt = promptEl ? promptEl.value.trim() : '';
    if (!name) { app.showToast('Persona needs a name', 'error'); return; }
    var providerSel = document.getElementById('chat-provider');
    var modelSel = document.getElementById('chat-model');
    try {
      var res = await fetch('/api/personas', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name, systemPrompt: systemPrompt,
          provider: providerSel ? providerSel.value : null,
          model: modelSel ? modelSel.value : null,
        }),
      });
      var data = await res.json();
      if (data.success) {
        app.showToast('Persona "' + name + '" saved', 'success');
        if (nameEl) nameEl.value = '';
        if (promptEl) promptEl.value = '';
        this.refresh();
      } else { app.showToast(data.error || 'Failed', 'error'); }
    } catch (err) { app.showToast(err.message || 'Network error', 'error'); }
  }

  async remove(id) {
    try {
      await fetch('/api/personas/' + encodeURIComponent(id), { method: 'DELETE' });
      this.refresh();
    } catch (err) { app.showToast(err.message || 'Failed', 'error'); }
  }

  _esc(str) { var d = document.createElement('div'); d.textContent = str; return d.innerHTML; }
}

/* ── 7. McpManager ── */

class McpManager {
  init() {
    var self = this;
    var connectBtn = document.getElementById('mcp-connect-btn');
    if (connectBtn) connectBtn.addEventListener('click', function () { self.connect(); });
    this.refresh();
  }

  async refresh() {
    var list = document.getElementById('mcp-server-list');
    if (!list) return;
    try {
      var data = await (await fetch('/api/mcp/servers')).json();
      var servers = data.servers || [];
      if (!servers.length) {
        list.innerHTML = '<div class="empty-state"><i class="fas fa-plug"></i><p>No MCP servers connected.</p></div>';
        return;
      }
      var self = this;
      list.innerHTML = '';
      servers.forEach(function (s) {
        var row = document.createElement('div');
        row.className = 'activity-item';
        row.innerHTML = '<i class="fas fa-plug"></i><span>' + self._esc(s.label) + ' <small>(' + s.tools.length + ' tools)</small></span>';
        var del = document.createElement('button');
        del.className = 'icon-btn';
        del.innerHTML = '<i class="fas fa-trash"></i>';
        del.title = 'Disconnect';
        del.addEventListener('click', function () { self.remove(s.id); });
        row.appendChild(del);
        list.appendChild(row);
      });
    } catch { /* ignore */ }
  }

  async connect() {
    var urlEl = document.getElementById('mcp-url');
    var authEl = document.getElementById('mcp-auth');
    var url = urlEl ? urlEl.value.trim() : '';
    if (!url) { app.showToast('Enter an MCP server URL', 'error'); return; }
    var headers = {};
    if (authEl && authEl.value.trim()) headers.Authorization = authEl.value.trim();
    app.showToast('Connecting to MCP server...', 'info');
    try {
      var res = await fetch('/api/mcp/connect', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url, headers: headers }),
      });
      var data = await res.json();
      if (data.success) {
        app.showToast('Connected: ' + data.server.label + ' (' + data.server.tools.length + ' tools)', 'success');
        if (urlEl) urlEl.value = '';
        if (authEl) authEl.value = '';
        this.refresh();
      } else { app.showToast(data.error || 'Connection failed', 'error'); }
    } catch (err) { app.showToast(err.message || 'Network error', 'error'); }
  }

  async remove(id) {
    try {
      await fetch('/api/mcp/servers/' + encodeURIComponent(id), { method: 'DELETE' });
      app.showToast('MCP server disconnected', 'info');
      this.refresh();
    } catch (err) { app.showToast(err.message || 'Failed', 'error'); }
  }

  _esc(str) { var d = document.createElement('div'); d.textContent = str; return d.innerHTML; }
}

/* ── 8. OctraAgent (main app) ── */

class OctraAgent {
  constructor() {
    this.settings = new SettingsManager();
    this.chat = new ChatManager();
    this.autopilot = new AutopilotEngine();
    this.codelab = new CodeLab();
    this.knowledge = new KnowledgeManager();
    this.personas = new PersonaManager();
    this.mcp = new McpManager();
    this.stats = JSON.parse(localStorage.getItem('octra_stats') || '{"messages":0,"tasks":0,"tokens":0}');
    this.activities = [];
  }

  async init() {
    await this.loadCatalogue();
    this.settings.init();
    this.chat.init();
    this.autopilot.init();
    this.codelab.init();
    this.knowledge.init();
    this.personas.init();
    this.mcp.init();
    this.setupNavigation();
    this.setupHamburger();
    this.updateDashboard();
    this.chat.loadHistory();
    console.log('Octra Network AI Agent v3.1.0 initialized');
  }

  // Refresh provider/model catalogue from the server (keeps UI in sync with backend).
  async loadCatalogue() {
    try {
      var data = await (await fetch('/api/models')).json();
      if (data && data.success && data.models) {
        MODEL_CATALOGUE = data.models;
        PROVIDER_ORDER = Object.keys(data.models);
        if (data.providers) {
          PROVIDER_ORDER.forEach(function (p) {
            if (data.providers[p] && data.providers[p].label) PROVIDER_LABELS[p] = data.providers[p].label;
          });
        }
        // Preserve the user's locally-configured custom/local models (server returns none).
        if (this.settings && this.settings.customModels && this.settings.customModels.length) {
          MODEL_CATALOGUE.custom = this.settings.customModels;
        }
      }
    } catch { /* offline — use static fallback */ }
  }

  setupNavigation() {
    var self = this;
    document.querySelectorAll('.nav-item').forEach(function (item) {
      item.addEventListener('click', function () { self.navigateTo(item.dataset.page); });
    });
  }

  navigateTo(page) {
    document.querySelectorAll('.page').forEach(function (p) { p.classList.remove('active'); });
    var targetPage = document.getElementById('page-' + page);
    if (targetPage) targetPage.classList.add('active');
    document.querySelectorAll('.nav-item').forEach(function (n) { n.classList.remove('active'); });
    var targetNav = document.querySelector('.nav-item[data-page="' + page + '"]');
    if (targetNav) targetNav.classList.add('active');
    if (page === 'knowledge' && this.knowledge) this.knowledge.refresh();
    var sidebar = document.querySelector('.sidebar');
    if (sidebar) sidebar.classList.remove('open');
  }

  setupHamburger() {
    var btn = document.getElementById('hamburger-btn');
    if (btn) {
      btn.addEventListener('click', function () {
        var sidebar = document.querySelector('.sidebar');
        if (sidebar) sidebar.classList.toggle('open');
      });
    }
  }

  showToast(message, type) {
    if (!type) type = 'info';
    var container = document.getElementById('toast-container');
    if (!container) return;
    var toast = document.createElement('div');
    toast.className = 'toast ' + type;
    var icons = { success: 'fa-check-circle', error: 'fa-times-circle', info: 'fa-info-circle', warning: 'fa-exclamation-triangle' };
    toast.innerHTML = '<i class="fas ' + (icons[type] || icons.info) + '"></i> ' + message;
    container.appendChild(toast);
    setTimeout(function () { if (toast.parentNode) toast.remove(); }, 4000);
  }

  updateStats(key, increment) {
    this.stats[key] = (this.stats[key] || 0) + increment;
    localStorage.setItem('octra_stats', JSON.stringify(this.stats));
    this.updateDashboard();
  }

  updateDashboard() {
    var msgEl = document.getElementById('stat-messages');
    var taskEl = document.getElementById('stat-tasks');
    var tokenEl = document.getElementById('stat-tokens');
    var providerEl = document.getElementById('stat-provider');
    if (msgEl) msgEl.textContent = this.stats.messages || 0;
    if (taskEl) taskEl.textContent = this.stats.tasks || 0;
    if (tokenEl) tokenEl.textContent = this.formatNumber(this.stats.tokens || 0);
    var configured = this.settings.configuredProviders();
    var activeProvider = configured.length === 0 ? 'None'
      : (configured.length === 1 ? PROVIDER_LABELS[configured[0]] : configured.length + ' providers');
    if (providerEl) providerEl.textContent = activeProvider;
  }

  formatNumber(num) {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
  }

  addActivity(text) {
    this.activities.unshift({ text: text, time: new Date() });
    if (this.activities.length > 20) this.activities.pop();
    var container = document.getElementById('recent-activity');
    if (!container) return;
    var self = this;
    container.innerHTML = this.activities.slice(0, 5).map(function (a) {
      return '<div class="activity-item"><i class="fas fa-bolt"></i><span>' + a.text + '</span><span class="time">' + self.timeAgo(a.time) + '</span></div>';
    }).join('');
  }

  timeAgo(date) {
    var seconds = Math.floor((new Date() - date) / 1000);
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago';
    if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ago';
    return Math.floor(seconds / 86400) + 'd ago';
  }
}

/* ── 7. Initialize ── */

var app = new OctraAgent();
document.addEventListener('DOMContentLoaded', function () { app.init(); });
