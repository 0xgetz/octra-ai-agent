/* ══════════════════════════════════════════════
   OCTRA NETWORK AI AGENT v2.1.0 - APPLICATION
   Complete client-side JavaScript
   ══════════════════════════════════════════════ */

// BUG-03: XSS sanitization helper using DOMPurify
// DOMPurify is loaded inline below; fall back to textContent if unavailable
function safeParse(markdown) {
  var raw = (typeof marked !== 'undefined') ? marked.parse(markdown) : markdown;
  if (typeof DOMPurify !== 'undefined') {
    return DOMPurify.sanitize(raw, { USE_PROFILES: { html: true } });
  }
  // fallback: return escaped text
  var div = document.createElement('div');
  div.textContent = raw;
  return div.innerHTML;
}

/* ── 1. SettingsManager ── */

class SettingsManager {
  constructor() {
    this.openaiKey = localStorage.getItem('octra_openai_key') || '';
    this.claudeKey = localStorage.getItem('octra_claude_key') || '';
    this.defaultProvider = localStorage.getItem('octra_default_provider') || 'openai';
    this.temperature = parseFloat(localStorage.getItem('octra_temperature') || '0.7');
    this.maxTokens = parseInt(localStorage.getItem('octra_max_tokens') || '4096');
    this.theme = localStorage.getItem('octra_theme') || 'dark';
    // FEAT-05: Custom system prompt
    this.systemPrompt = localStorage.getItem('octra_system_prompt') || '';
  }

  init() {
    var openaiInput = document.getElementById('openai-key');
    var claudeInput = document.getElementById('claude-key');
    var defaultProviderSelect = document.getElementById('default-provider');
    var tempSlider = document.getElementById('temperature-slider');
    var tempValue = document.getElementById('temp-value');
    var maxTokensInput = document.getElementById('max-tokens-input');
    var systemPromptInput = document.getElementById('system-prompt-input');

    if (openaiInput) openaiInput.value = this.openaiKey;
    if (claudeInput) claudeInput.value = this.claudeKey;
    if (defaultProviderSelect) defaultProviderSelect.value = this.defaultProvider;
    if (tempSlider) tempSlider.value = this.temperature;
    if (tempValue) tempValue.textContent = this.temperature;
    if (maxTokensInput) maxTokensInput.value = this.maxTokens;
    if (systemPromptInput) systemPromptInput.value = this.systemPrompt;

    var self = this;

    document.querySelectorAll('.save-key-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        self.saveKey(btn.dataset.provider);
      });
    });

    document.querySelectorAll('.toggle-visibility').forEach(function(btn) {
      btn.addEventListener('click', function() {
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
      defaultProviderSelect.addEventListener('change', function() {
        self.defaultProvider = defaultProviderSelect.value;
        localStorage.setItem('octra_default_provider', self.defaultProvider);
      });
    }

    if (tempSlider) {
      tempSlider.addEventListener('input', function() {
        self.temperature = parseFloat(tempSlider.value);
        localStorage.setItem('octra_temperature', self.temperature.toString());
        if (tempValue) tempValue.textContent = self.temperature;
      });
    }

    if (maxTokensInput) {
      maxTokensInput.addEventListener('change', function() {
        self.maxTokens = parseInt(maxTokensInput.value) || 4096;
        localStorage.setItem('octra_max_tokens', self.maxTokens.toString());
      });
    }

    // FEAT-05: System prompt save
    if (systemPromptInput) {
      systemPromptInput.addEventListener('input', function() {
        self.systemPrompt = systemPromptInput.value;
        localStorage.setItem('octra_system_prompt', self.systemPrompt);
      });
    }

    document.querySelectorAll('.theme-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        self.applyTheme(btn.dataset.theme);
      });
    });

    var clearBtn = document.getElementById('clear-all-data');
    if (clearBtn) {
      clearBtn.addEventListener('click', function() { self.clearAll(); });
    }

    this.applyTheme(this.theme);
    this.updateKeyStatus();
    this.updateConnectionStatus();
  }

  saveKey(provider) {
    var inputId = provider === 'openai' ? 'openai-key' : 'claude-key';
    var key = document.getElementById(inputId).value.trim();
    if (!key) { app.showToast('Please enter an API key', 'error'); return; }
    if (provider === 'openai') {
      this.openaiKey = key;
      localStorage.setItem('octra_openai_key', key);
    } else {
      this.claudeKey = key;
      localStorage.setItem('octra_claude_key', key);
    }
    this.updateKeyStatus();
    this.updateConnectionStatus();
    app.showToast((provider === 'openai' ? 'OpenAI' : 'Claude') + ' API key saved!', 'success');
  }

  updateKeyStatus() {
    var openaiStatus = document.getElementById('openai-status');
    var claudeStatus = document.getElementById('claude-status');
    if (openaiStatus) {
      openaiStatus.innerHTML = this.openaiKey
        ? '<i class="fas fa-circle"></i> Configured'
        : '<i class="fas fa-circle"></i> Not configured';
      openaiStatus.className = 'key-status ' + (this.openaiKey ? 'configured' : 'not-configured');
    }
    if (claudeStatus) {
      claudeStatus.innerHTML = this.claudeKey
        ? '<i class="fas fa-circle"></i> Configured'
        : '<i class="fas fa-circle"></i> Not configured';
      claudeStatus.className = 'key-status ' + (this.claudeKey ? 'configured' : 'not-configured');
    }
  }

  updateConnectionStatus() {
    var el = document.getElementById('connection-status');
    if (!el) return;
    var dot = el.querySelector('.status-dot');
    var text = el.querySelector('.status-text');
    if (this.openaiKey || this.claudeKey) {
      dot.classList.add('connected');
      var providers = [];
      if (this.openaiKey) providers.push('OpenAI');
      if (this.claudeKey) providers.push('Claude');
      text.textContent = providers.join(' & ') + ': Connected';
    } else {
      dot.classList.remove('connected');
      text.textContent = 'No provider connected';
    }
  }

  getActiveKey(provider) {
    return provider === 'openai' ? this.openaiKey : this.claudeKey;
  }

  applyTheme(theme) {
    this.theme = theme;
    localStorage.setItem('octra_theme', theme);
    document.documentElement.setAttribute('data-theme', theme);
    document.querySelectorAll('.theme-btn').forEach(function(btn) {
      btn.classList.toggle('active', btn.dataset.theme === theme);
    });
  }

  clearAll() {
    if (!confirm('This will delete all your API keys and settings. Are you sure?')) return;
    ['octra_openai_key','octra_claude_key','octra_default_provider','octra_temperature',
     'octra_max_tokens','octra_theme','octra_chat_history','octra_stats','octra_system_prompt'].forEach(function(k) {
      localStorage.removeItem(k);
    });
    this.openaiKey = '';
    this.claudeKey = '';
    this.systemPrompt = '';
    var openaiInput = document.getElementById('openai-key');
    var claudeInput = document.getElementById('claude-key');
    var systemPromptInput = document.getElementById('system-prompt-input');
    if (openaiInput) openaiInput.value = '';
    if (claudeInput) claudeInput.value = '';
    if (systemPromptInput) systemPromptInput.value = '';
    this.updateKeyStatus();
    this.updateConnectionStatus();
    app.showToast('All data cleared', 'info');
  }
}

/* ── 2. ChatManager ── */

// FEAT-03: Token cost estimation (approximate, per 1M tokens)
const COST_PER_1M = {
  'gpt-4o': { input: 5.0, output: 15.0 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4-turbo': { input: 10.0, output: 30.0 },
  'gpt-4': { input: 30.0, output: 60.0 },
  'gpt-3.5-turbo': { input: 0.5, output: 1.5 },
  'claude-opus-4-5': { input: 15.0, output: 75.0 },
  'claude-sonnet-4-5': { input: 3.0, output: 15.0 },
  'claude-3-5-haiku-20241022': { input: 0.8, output: 4.0 },
  'claude-3-opus-20240229': { input: 15.0, output: 75.0 },
};

function estimateCost(model, promptTokens, completionTokens) {
  var rates = COST_PER_1M[model];
  if (!rates) return null;
  var cost = (promptTokens / 1e6) * rates.input + (completionTokens / 1e6) * rates.output;
  return cost < 0.01 ? '<$0.01' : '$' + cost.toFixed(4);
}

class ChatManager {
  constructor() {
    this.messages = [];
    this.isLoading = false;
    this.currentEventSource = null;
    this.totalTokens = 0;
    this.totalCost = 0;
  }

  init() {
    var self = this;

    var sendBtn = document.getElementById('send-btn');
    if (sendBtn) sendBtn.addEventListener('click', function() { self.sendMessage(); });

    var chatInput = document.getElementById('chat-input');
    if (chatInput) {
      chatInput.addEventListener('keydown', function(e) {
        if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); self.sendMessage(); }
      });
      chatInput.addEventListener('input', function() {
        chatInput.style.height = 'auto';
        chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
      });
    }

    var clearChatBtn = document.getElementById('clear-chat-btn');
    if (clearChatBtn) clearChatBtn.addEventListener('click', function() { self.clearChat(); });

    // FEAT-04: JSON export button
    var exportChatBtn = document.getElementById('export-chat-btn');
    if (exportChatBtn) exportChatBtn.addEventListener('click', function() { self.exportChat(); });

    this.setupProviderModelSync();
  }

  setupProviderModelSync() {
    var providerSelect = document.getElementById('chat-provider');
    var modelSelect = document.getElementById('chat-model');
    if (!providerSelect || !modelSelect) return;

    var updateModels = function() {
      var provider = providerSelect.value;
      modelSelect.innerHTML = '';
      var models;
      if (provider === 'openai') {
        // BUG-01 (openai side ok, was fine)
        models = [['gpt-4o','GPT-4o'],['gpt-4o-mini','GPT-4o Mini'],['gpt-4-turbo','GPT-4 Turbo'],['gpt-4','GPT-4'],['gpt-3.5-turbo','GPT-3.5 Turbo']];
      } else {
        // BUG-01: Fixed Claude model IDs
        models = [['claude-sonnet-4-5','Claude Sonnet 4.5'],['claude-opus-4-5','Claude Opus 4.5'],['claude-3-5-haiku-20241022','Claude 3.5 Haiku'],['claude-3-opus-20240229','Claude 3 Opus']];
      }
      models.forEach(function(m) {
        var opt = document.createElement('option');
        opt.value = m[0]; opt.textContent = m[1];
        modelSelect.appendChild(opt);
      });
    };

    providerSelect.addEventListener('change', updateModels);
    updateModels();
  }

  // BUG-12: Specific error messages for HTTP status codes
  async apiErrorMessage(response) {
    var body = {};
    try { body = await response.json(); } catch {}
    var serverMsg = body.error || body.message || '';
    if (response.status === 429) return 'Rate limit exceeded. Please wait and try again.' + (serverMsg ? ' (' + serverMsg + ')' : '');
    if (response.status === 401) return 'Invalid API key. Please check your key in Settings.';
    if (response.status === 403) return 'Access forbidden. Check your API key permissions.';
    if (response.status === 500) return 'Server error. Please try again in a moment.' + (serverMsg ? ' (' + serverMsg + ')' : '');
    if (response.status === 503) return 'AI service temporarily unavailable. Please try again.';
    return 'API error (' + response.status + '): ' + (serverMsg || response.statusText);
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

    if (!apiKey) {
      app.showToast('Please configure your ' + (provider === 'openai' ? 'OpenAI' : 'Claude') + ' API key in Settings', 'error');
      return;
    }

    this.addMessage('user', text);
    input.value = '';
    input.style.height = 'auto';
    this.setLoading(true);

    // FEAT-01: SSE streaming
    var assistantMsgEl = this.createStreamingMessageEl();
    var self = this;
    var accumulated = '';

    try {
      var response = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: provider,
          apiKey: apiKey,
          model: model,
          messages: this.messages,
          temperature: app.settings.temperature,
          maxTokens: app.settings.maxTokens,
          systemPrompt: app.settings.systemPrompt || undefined,
        }),
      });

      if (!response.ok) {
        var errMsg = await this.apiErrorMessage(response);
        this.finishStreamingMessage(assistantMsgEl, 'Error: ' + errMsg);
        app.showToast(errMsg, 'error');
        this.setLoading(false);
        return;
      }

      var reader = response.body.getReader();
      var decoder = new TextDecoder();
      var buffer = '';

      while (true) {
        var _a = await reader.read(), done = _a.done, value = _a.value;
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        var parts = buffer.split('\n\n');
        buffer = parts.pop();
        for (var i = 0; i < parts.length; i++) {
          var part = parts[i].trim();
          if (!part) continue;
          var eventMatch = part.match(/^event: (\w+)/m);
          var dataMatch = part.match(/^data: (.+)/m);
          if (!eventMatch || !dataMatch) continue;
          var evtType = eventMatch[1];
          var evtData;
          try { evtData = JSON.parse(dataMatch[1]); } catch { continue; }

          if (evtType === 'delta') {
            accumulated += evtData.content;
            self.updateStreamingMessage(assistantMsgEl, accumulated);
          } else if (evtType === 'done') {
            self.finishStreamingMessage(assistantMsgEl, accumulated);
            self.messages.push({ role: 'assistant', content: accumulated });
            var usage = evtData.usage || {};
            app.updateStats('messages', 1);
            app.updateStats('tokens', usage.total_tokens || 0);
            // FEAT-03: Token/cost display
            if (usage.total_tokens) {
              var cost = estimateCost(model, usage.prompt_tokens || 0, usage.completion_tokens || 0);
              self.showUsageInfo(usage, cost);
            }
          } else if (evtType === 'error') {
            self.finishStreamingMessage(assistantMsgEl, 'Error: ' + (evtData.error || 'Unknown error'));
            app.showToast(evtData.error || 'Streaming error', 'error');
          }
        }
      }
    } catch (err) {
      // BUG-12: specific error types
      var msg;
      if (err.name === 'AbortError') {
        msg = 'Request timed out. Please try again.';
      } else if (err.message && err.message.includes('fetch')) {
        msg = 'Network error — check your connection.';
      } else {
        msg = err.message || 'Unexpected error';
      }
      this.finishStreamingMessage(assistantMsgEl, 'Connection error: ' + msg);
      app.showToast(msg, 'error');
    }

    this.setLoading(false);
    this.saveHistory();
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
    // BUG-03: DOMPurify sanitization
    contentDiv.innerHTML = safeParse(text) + '<span class="cursor-blink">|</span>';
    var container = document.getElementById('chat-messages');
    if (container) container.scrollTop = container.scrollHeight;
  }

  finishStreamingMessage(el, text) {
    if (!el) return;
    var contentDiv = el.querySelector('.message-content');
    if (!contentDiv) return;
    el.classList.remove('streaming');
    // BUG-03: sanitize
    contentDiv.innerHTML = safeParse(text);
    contentDiv.querySelectorAll('pre code').forEach(function(block) {
      if (typeof hljs !== 'undefined') hljs.highlightElement(block);
      var pre = block.parentElement;
      pre.style.position = 'relative';
      var copyBtn = document.createElement('button');
      copyBtn.className = 'code-copy-btn';
      copyBtn.textContent = 'Copy';
      copyBtn.onclick = function() {
        navigator.clipboard.writeText(block.textContent);
        copyBtn.textContent = 'Copied!';
        setTimeout(function() { copyBtn.textContent = 'Copy'; }, 1500);
      };
      pre.appendChild(copyBtn);
    });
    var container = document.getElementById('chat-messages');
    if (container) container.scrollTop = container.scrollHeight;
  }

  // FEAT-03: Show usage info below message
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

  addMessage(role, content) {
    this.messages.push({ role: role, content: content });
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
      // BUG-03: sanitize before innerHTML
      contentDiv.innerHTML = safeParse(content);
      contentDiv.querySelectorAll('pre code').forEach(function(block) {
        if (typeof hljs !== 'undefined') hljs.highlightElement(block);
        var pre = block.parentElement;
        pre.style.position = 'relative';
        var copyBtn = document.createElement('button');
        copyBtn.className = 'code-copy-btn';
        copyBtn.textContent = 'Copy';
        copyBtn.onclick = function() {
          navigator.clipboard.writeText(block.textContent);
          copyBtn.textContent = 'Copied!';
          setTimeout(function() { copyBtn.textContent = 'Copy'; }, 1500);
        };
        pre.appendChild(copyBtn);
      });
    } else {
      contentDiv.textContent = content;
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

  // FEAT-04: JSON export (in addition to text export)
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
          msgs.forEach(function(m) { self.addMessage(m.role, m.content); });
        }
      }
    } catch (e) { /* ignore corrupt data */ }
  }
}

/* ── 3. AutopilotEngine ── */

class AutopilotEngine {
  constructor() {
    this.isRunning = false;
    this.currentRunId = null;
  }

  init() {
    var self = this;
    var startBtn = document.getElementById('autopilot-start');
    if (startBtn) startBtn.addEventListener('click', function() { self.start(); });

    var stopBtn = document.getElementById('autopilot-stop');
    if (stopBtn) stopBtn.addEventListener('click', function() { self.stop(); });

    this.setupProviderModelSync();
  }

  setupProviderModelSync() {
    var providerSelect = document.getElementById('autopilot-provider');
    var modelSelect = document.getElementById('autopilot-model');
    if (!providerSelect || !modelSelect) return;

    var updateModels = function() {
      var provider = providerSelect.value;
      modelSelect.innerHTML = '';
      var models;
      if (provider === 'openai') {
        models = [['gpt-4o','GPT-4o'],['gpt-4o-mini','GPT-4o Mini'],['gpt-4-turbo','GPT-4 Turbo'],['gpt-4','GPT-4'],['gpt-3.5-turbo','GPT-3.5 Turbo']];
      } else {
        // BUG-01: Fixed Claude model IDs
        models = [['claude-sonnet-4-5','Claude Sonnet 4.5'],['claude-opus-4-5','Claude Opus 4.5'],['claude-3-5-haiku-20241022','Claude 3.5 Haiku'],['claude-3-opus-20240229','Claude 3 Opus']];
      }
      models.forEach(function(m) {
        var opt = document.createElement('option');
        opt.value = m[0]; opt.textContent = m[1];
        modelSelect.appendChild(opt);
      });
    };

    providerSelect.addEventListener('change', updateModels);
    updateModels();
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

    if (!apiKey) {
      app.showToast('Please configure your ' + (provider === 'openai' ? 'OpenAI' : 'Claude') + ' API key in Settings', 'error');
      return;
    }

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

    try {
      // BUG-07: SSE streaming for real-time progress
      var response = await fetch('/api/autopilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: provider,
          apiKey: apiKey,
          model: model,
          goal: goal,
          temperature: app.settings.temperature,
          maxTokens: app.settings.maxTokens,
        }),
      });

      if (!response.ok) {
        app.showToast('Autopilot failed to start (' + response.status + ')', 'error');
        this._resetUI();
        return;
      }

      var reader = response.body.getReader();
      var decoder = new TextDecoder();
      var buffer = '';
      var completedCount = 0;

      while (true) {
        var _a = await reader.read(), done = _a.done, value = _a.value;
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        var parts = buffer.split('\n\n');
        buffer = parts.pop();

        for (var i = 0; i < parts.length; i++) {
          var part = parts[i].trim();
          if (!part) continue;
          var eventMatch = part.match(/^event: (\w+)/m);
          var dataMatch = part.match(/^data: (.+)/m);
          if (!eventMatch || !dataMatch) continue;
          var evtType = eventMatch[1];
          var evtData;
          try { evtData = JSON.parse(dataMatch[1]); } catch { continue; }

          if (evtType === 'run_id') {
            // BUG-02: Track runId for cancellation
            self.currentRunId = evtData.runId;
          } else if (evtType === 'plan') {
            planSteps = evtData.steps;
            if (stepsContainer) stepsContainer.innerHTML = '';
            planSteps.forEach(function(stepText, idx) {
              var el = self._createStepEl(idx, stepText, 'pending');
              stepElements[idx] = el;
              if (stepsContainer) stepsContainer.appendChild(el);
            });
          } else if (evtType === 'step_start') {
            var el = stepElements[evtData.index];
            if (el) self._updateStepEl(el, 'running', null);
          } else if (evtType === 'step_done') {
            completedCount++;
            var el = stepElements[evtData.index];
            if (el) self._updateStepEl(el, evtData.status, evtData.result);
            var pct = (completedCount / planSteps.length) * 100;
            if (progressBar) progressBar.style.width = pct + '%';
          } else if (evtType === 'complete') {
            if (progressBar) progressBar.style.width = '100%';
            if (resultsSection) resultsSection.style.display = 'block';
            var output = document.getElementById('autopilot-output');
            if (output) {
              var completedSteps = evtData.steps.filter(function(s) { return s.status === 'completed'; }).length;
              var html = '<strong>Goal:</strong> ' + self._esc(goal) + '<br><br>';
              html += '<strong>Completed:</strong> ' + completedSteps + '/' + evtData.steps.length + ' steps<br><br>';
              // BUG-03: sanitize autopilot output
              evtData.steps.forEach(function(s, idx) {
                html += '<strong>Step ' + (idx+1) + ':</strong> ' + self._esc(s.step) + '<br>' + safeParse(s.result || '') + '<br>';
              });
              output.innerHTML = html;
            }
            app.updateStats('tasks', 1);
            app.showToast('Autopilot complete!', 'success');
            app.addActivity('Autopilot completed: ' + completedCount + '/' + planSteps.length + ' steps');
          } else if (evtType === 'cancelled') {
            app.showToast('Autopilot stopped', 'warning');
            app.addActivity('Autopilot cancelled');
          } else if (evtType === 'error') {
            app.showToast('Autopilot error: ' + (evtData.error || 'Unknown'), 'error');
          }
        }
      }
    } catch (err) {
      if (!err.message.includes('abort')) {
        app.showToast('Autopilot error: ' + err.message, 'error');
      }
    }

    self._resetUI();
  }

  async stop() {
    // BUG-02: Actually cancel the server-side run
    if (this.currentRunId) {
      try {
        await fetch('/api/autopilot/stop', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ runId: this.currentRunId }),
        });
      } catch {}
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

  _updateStepEl(el, status, result) {
    el.className = 'step-item ' + status;
    var iconDiv = el.querySelector('.step-icon');
    var resultDiv = el.querySelector('.step-result');
    if (iconDiv) {
      var iconClass = status === 'running' ? 'fa-spinner fa-spin' : (status === 'completed' ? 'fa-check' : (status === 'failed' ? 'fa-times' : 'fa-clock'));
      iconDiv.innerHTML = '<i class="fas ' + iconClass + '"></i>';
    }
    if (resultDiv && result !== null) {
      // BUG-03: sanitize autopilot step results
      resultDiv.innerHTML = safeParse(result);
    }
  }
}

/* ── 4. CodeLab ── */

class CodeLab {
  constructor() {
    this.lastOutput = '';
  }

  init() {
    var self = this;

    document.querySelectorAll('.codelab-actions .action-btn').forEach(function(btn) {
      btn.addEventListener('click', function() { self.handleAction(btn.dataset.action); });
    });

    var copyBtn = document.getElementById('copy-output-btn');
    if (copyBtn) copyBtn.addEventListener('click', function() { self.copyOutput(); });

    // BUG-08: Model selector syncs with provider
    this.setupProviderModelSync();
  }

  setupProviderModelSync() {
    var providerSelect = document.getElementById('codelab-provider');
    var modelSelect = document.getElementById('codelab-model');
    if (!providerSelect || !modelSelect) return;

    var updateModels = function() {
      var provider = providerSelect.value;
      modelSelect.innerHTML = '';
      var models;
      if (provider === 'openai') {
        models = [['gpt-4o','GPT-4o'],['gpt-4o-mini','GPT-4o Mini'],['gpt-4','GPT-4'],['gpt-3.5-turbo','GPT-3.5 Turbo']];
      } else {
        // BUG-01: Correct Claude IDs in CodeLab
        models = [['claude-sonnet-4-5','Claude Sonnet 4.5'],['claude-3-5-haiku-20241022','Claude 3.5 Haiku'],['claude-opus-4-5','Claude Opus 4.5']];
      }
      models.forEach(function(m) {
        var opt = document.createElement('option');
        opt.value = m[0]; opt.textContent = m[1];
        modelSelect.appendChild(opt);
      });
    };

    providerSelect.addEventListener('change', updateModels);
    // Sync default provider from settings
    if (app && app.settings) providerSelect.value = app.settings.defaultProvider;
    updateModels();
  }

  async handleAction(action) {
    var inputEl = document.getElementById('codelab-input');
    if (!inputEl) return;
    var input = inputEl.value.trim();
    if (!input) { app.showToast('Please enter code or a description', 'error'); return; }

    // BUG-08: Use CodeLab's own provider/model selectors
    var providerSelect = document.getElementById('codelab-provider');
    var modelSelect = document.getElementById('codelab-model');
    var provider = providerSelect ? providerSelect.value : app.settings.defaultProvider;
    var model = modelSelect ? modelSelect.value : (provider === 'openai' ? 'gpt-4o' : 'claude-sonnet-4-5');
    var apiKey = app.settings.getActiveKey(provider);

    if (!apiKey) { app.showToast('Please configure an API key in Settings', 'error'); return; }

    var outputEl = document.getElementById('codelab-output');
    var copyBtn = document.getElementById('copy-output-btn');
    if (outputEl) outputEl.innerHTML = '<div class="empty-state"><div class="spinner"></div><p>Processing...</p></div>';
    if (copyBtn) copyBtn.style.display = 'none';

    try {
      var response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: provider,
          apiKey: apiKey,
          model: model,  // BUG-08: uses selected model
          code: input,
          action: action,
          prompt: input,
          temperature: app.settings.temperature,
          maxTokens: app.settings.maxTokens,
        }),
      });

      var data = await response.json();

      if (data.success) {
        this.lastOutput = data.result;
        if (outputEl) {
          // BUG-03: sanitize CodeLab output
          outputEl.innerHTML = safeParse(data.result);
          outputEl.querySelectorAll('pre code').forEach(function(block) {
            if (typeof hljs !== 'undefined') hljs.highlightElement(block);
          });
        }
        if (copyBtn) copyBtn.style.display = 'flex';
        app.updateStats('messages', 1);
        app.addActivity('Code ' + action + ': completed');
        // FEAT-03: Show token usage if available
        if (data.usage && data.usage.total_tokens) {
          var cost = estimateCost(model, data.usage.prompt_tokens || 0, data.usage.completion_tokens || 0);
          var info = 'Tokens: ' + data.usage.total_tokens + (cost ? ' | Est. cost: ' + cost : '');
          app.showToast(info, 'info');
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

/* ── 5. OctraAgent (main app) ── */

class OctraAgent {
  constructor() {
    this.settings = new SettingsManager();
    this.chat = new ChatManager();
    this.autopilot = new AutopilotEngine();
    this.codelab = new CodeLab();
    this.stats = JSON.parse(localStorage.getItem('octra_stats') || '{"messages":0,"tasks":0,"tokens":0}');
    this.activities = [];
  }

  init() {
    this.settings.init();
    this.chat.init();
    this.autopilot.init();
    this.codelab.init();
    this.setupNavigation();
    this.setupHamburger();
    this.updateDashboard();
    this.chat.loadHistory();
    console.log('Octra Network AI Agent v2.1.0 initialized');
  }

  setupNavigation() {
    var self = this;
    document.querySelectorAll('.nav-item').forEach(function(item) {
      item.addEventListener('click', function() { self.navigateTo(item.dataset.page); });
    });
  }

  navigateTo(page) {
    document.querySelectorAll('.page').forEach(function(p) { p.classList.remove('active'); });
    var targetPage = document.getElementById('page-' + page);
    if (targetPage) targetPage.classList.add('active');
    document.querySelectorAll('.nav-item').forEach(function(n) { n.classList.remove('active'); });
    var targetNav = document.querySelector('.nav-item[data-page="' + page + '"]');
    if (targetNav) targetNav.classList.add('active');
    var sidebar = document.querySelector('.sidebar');
    if (sidebar) sidebar.classList.remove('open');
  }

  setupHamburger() {
    var btn = document.getElementById('hamburger-btn');
    if (btn) {
      btn.addEventListener('click', function() {
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
    setTimeout(function() { if (toast.parentNode) toast.remove(); }, 4000);
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
    var activeProvider = this.settings.openaiKey
      ? (this.settings.claudeKey ? 'Both' : 'OpenAI')
      : (this.settings.claudeKey ? 'Claude' : 'None');
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
    container.innerHTML = this.activities.slice(0, 5).map(function(a) {
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

/* ── 6. Initialize ── */

var app = new OctraAgent();
document.addEventListener('DOMContentLoaded', function() { app.init(); });
