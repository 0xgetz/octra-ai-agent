/* ══════════════════════════════════════════════
   OCTRA NETWORK AI AGENT - APPLICATION
   Complete client-side JavaScript
   ══════════════════════════════════════════════ */

/* ── 1. SettingsManager ── */

class SettingsManager {
  constructor() {
    this.openaiKey = localStorage.getItem('octra_openai_key') || '';
    this.claudeKey = localStorage.getItem('octra_claude_key') || '';
    this.defaultProvider = localStorage.getItem('octra_default_provider') || 'openai';
    this.temperature = parseFloat(localStorage.getItem('octra_temperature') || '0.7');
    this.maxTokens = parseInt(localStorage.getItem('octra_max_tokens') || '4096');
    this.theme = localStorage.getItem('octra_theme') || 'dark';
  }

  init() {
    var openaiInput = document.getElementById('openai-key');
    var claudeInput = document.getElementById('claude-key');
    var defaultProviderSelect = document.getElementById('default-provider');
    var tempSlider = document.getElementById('temperature-slider');
    var tempValue = document.getElementById('temp-value');
    var maxTokensInput = document.getElementById('max-tokens-input');

    if (openaiInput) openaiInput.value = this.openaiKey;
    if (claudeInput) claudeInput.value = this.claudeKey;
    if (defaultProviderSelect) defaultProviderSelect.value = this.defaultProvider;
    if (tempSlider) tempSlider.value = this.temperature;
    if (tempValue) tempValue.textContent = this.temperature;
    if (maxTokensInput) maxTokensInput.value = this.maxTokens;

    var self = this;

    document.querySelectorAll('.save-key-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var provider = btn.dataset.provider;
        self.saveKey(provider);
      });
    });

    document.querySelectorAll('.toggle-visibility').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var targetId = btn.dataset.target;
        var input = document.getElementById(targetId);
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

    document.querySelectorAll('.theme-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        self.applyTheme(btn.dataset.theme);
      });
    });

    var clearBtn = document.getElementById('clear-all-data');
    if (clearBtn) {
      clearBtn.addEventListener('click', function() {
        self.clearAll();
      });
    }

    this.applyTheme(this.theme);
    this.updateKeyStatus();
    this.updateConnectionStatus();
  }

  saveKey(provider) {
    var inputId = provider === 'openai' ? 'openai-key' : 'claude-key';
    var key = document.getElementById(inputId).value.trim();
    if (!key) {
      app.showToast('Please enter an API key', 'error');
      return;
    }
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
      if (this.openaiKey) {
        openaiStatus.innerHTML = '<i class="fas fa-circle"></i> Configured';
        openaiStatus.className = 'key-status configured';
      } else {
        openaiStatus.innerHTML = '<i class="fas fa-circle"></i> Not configured';
        openaiStatus.className = 'key-status not-configured';
      }
    }
    if (claudeStatus) {
      if (this.claudeKey) {
        claudeStatus.innerHTML = '<i class="fas fa-circle"></i> Configured';
        claudeStatus.className = 'key-status configured';
      } else {
        claudeStatus.innerHTML = '<i class="fas fa-circle"></i> Not configured';
        claudeStatus.className = 'key-status not-configured';
      }
    }
  }

  updateConnectionStatus() {
    var el = document.getElementById('connection-status');
    if (!el) return;
    var dot = el.querySelector('.status-dot');
    var text = el.querySelector('.status-text');
    var hasOpenAI = !!this.openaiKey;
    var hasClaude = !!this.claudeKey;
    if (hasOpenAI || hasClaude) {
      dot.classList.add('connected');
      var providers = [];
      if (hasOpenAI) providers.push('OpenAI');
      if (hasClaude) providers.push('Claude');
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
    localStorage.removeItem('octra_openai_key');
    localStorage.removeItem('octra_claude_key');
    localStorage.removeItem('octra_default_provider');
    localStorage.removeItem('octra_temperature');
    localStorage.removeItem('octra_max_tokens');
    localStorage.removeItem('octra_theme');
    localStorage.removeItem('octra_chat_history');
    localStorage.removeItem('octra_stats');
    this.openaiKey = '';
    this.claudeKey = '';
    var openaiInput = document.getElementById('openai-key');
    var claudeInput = document.getElementById('claude-key');
    if (openaiInput) openaiInput.value = '';
    if (claudeInput) claudeInput.value = '';
    this.updateKeyStatus();
    this.updateConnectionStatus();
    app.showToast('All data cleared', 'info');
  }
}

/* ── 2. ChatManager ── */

class ChatManager {
  constructor() {
    this.messages = [];
    this.isLoading = false;
  }

  init() {
    var self = this;

    var sendBtn = document.getElementById('send-btn');
    if (sendBtn) {
      sendBtn.addEventListener('click', function() {
        self.sendMessage();
      });
    }

    var chatInput = document.getElementById('chat-input');
    if (chatInput) {
      chatInput.addEventListener('keydown', function(e) {
        if (e.ctrlKey && e.key === 'Enter') {
          e.preventDefault();
          self.sendMessage();
        }
      });
      chatInput.addEventListener('input', function() {
        chatInput.style.height = 'auto';
        chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
      });
    }

    var clearChatBtn = document.getElementById('clear-chat-btn');
    if (clearChatBtn) {
      clearChatBtn.addEventListener('click', function() {
        self.clearChat();
      });
    }

    var exportChatBtn = document.getElementById('export-chat-btn');
    if (exportChatBtn) {
      exportChatBtn.addEventListener('click', function() {
        self.exportChat();
      });
    }

    this.setupProviderModelSync();
  }

  setupProviderModelSync() {
    var providerSelect = document.getElementById('chat-provider');
    var modelSelect = document.getElementById('chat-model');
    if (!providerSelect || !modelSelect) return;

    providerSelect.addEventListener('change', function() {
      var provider = providerSelect.value;
      modelSelect.innerHTML = '';
      var models;
      if (provider === 'openai') {
        models = [['gpt-4o', 'GPT-4o'], ['gpt-4', 'GPT-4'], ['gpt-3.5-turbo', 'GPT-3.5 Turbo']];
      } else {
        models = [['claude-sonnet-4-20250514', 'Claude Sonnet 4'], ['claude-3-haiku-20240307', 'Claude 3 Haiku']];
      }
      models.forEach(function(m) {
        var opt = document.createElement('option');
        opt.value = m[0];
        opt.textContent = m[1];
        modelSelect.appendChild(opt);
      });
    });
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

    try {
      var response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: provider,
          apiKey: apiKey,
          model: model,
          messages: this.messages,
          temperature: app.settings.temperature,
          maxTokens: app.settings.maxTokens
        })
      });

      var data = await response.json();

      if (data.success) {
        this.addMessage('assistant', data.message.content);
        if (data.usage) {
          app.updateStats('messages', 1);
          app.updateStats('tokens', data.usage.total_tokens || 0);
        }
      } else {
        this.addMessage('assistant', 'Error: ' + (data.error || 'Something went wrong'));
        app.showToast('Failed to get response', 'error');
      }
    } catch (err) {
      this.addMessage('assistant', 'Connection error: ' + err.message);
      app.showToast('Network error', 'error');
    }

    this.setLoading(false);
    this.saveHistory();
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
    if (role === 'user') {
      avatar.innerHTML = '<i class="fas fa-user"></i>';
    } else {
      avatar.innerHTML = '<i class="fas fa-robot"></i>';
    }

    var contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';

    if (role === 'assistant') {
      contentDiv.innerHTML = marked.parse(content);
      contentDiv.querySelectorAll('pre code').forEach(function(block) {
        hljs.highlightElement(block);
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

  exportChat() {
    if (this.messages.length === 0) {
      app.showToast('No messages to export', 'warning');
      return;
    }
    var text = 'Octra Network AI Agent - Chat Export\n';
    text += '========================================\n\n';
    this.messages.forEach(function(m) {
      text += '[' + m.role.toUpperCase() + ']\n' + m.content + '\n\n';
    });
    var blob = new Blob([text], { type: 'text/plain' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'octra-chat-' + new Date().toISOString().slice(0, 10) + '.txt';
    a.click();
    app.showToast('Chat exported', 'success');
  }

  saveHistory() {
    localStorage.setItem('octra_chat_history', JSON.stringify(this.messages.slice(-50)));
  }

  loadHistory() {
    var saved = localStorage.getItem('octra_chat_history');
    if (saved) {
      try {
        var msgs = JSON.parse(saved);
        if (msgs && msgs.length > 0) {
          var container = document.getElementById('chat-messages');
          if (container) {
            this.messages = [];
            container.innerHTML = '';
            var self = this;
            msgs.forEach(function(m) {
              self.addMessage(m.role, m.content);
            });
          }
        }
      } catch (e) {
        /* ignore corrupt data */
      }
    }
  }
}

/* ── 3. AutopilotEngine ── */

class AutopilotEngine {
  constructor() {
    this.isRunning = false;
    this.shouldStop = false;
    this.steps = [];
  }

  init() {
    var self = this;

    var startBtn = document.getElementById('autopilot-start');
    if (startBtn) {
      startBtn.addEventListener('click', function() {
        self.start();
      });
    }

    var stopBtn = document.getElementById('autopilot-stop');
    if (stopBtn) {
      stopBtn.addEventListener('click', function() {
        self.stop();
      });
    }

    this.setupProviderModelSync();
  }

  setupProviderModelSync() {
    var providerSelect = document.getElementById('autopilot-provider');
    var modelSelect = document.getElementById('autopilot-model');
    if (!providerSelect || !modelSelect) return;

    providerSelect.addEventListener('change', function() {
      var provider = providerSelect.value;
      modelSelect.innerHTML = '';
      var models;
      if (provider === 'openai') {
        models = [['gpt-4o', 'GPT-4o'], ['gpt-4', 'GPT-4'], ['gpt-3.5-turbo', 'GPT-3.5 Turbo']];
      } else {
        models = [['claude-sonnet-4-20250514', 'Claude Sonnet 4'], ['claude-3-haiku-20240307', 'Claude 3 Haiku']];
      }
      models.forEach(function(m) {
        var opt = document.createElement('option');
        opt.value = m[0];
        opt.textContent = m[1];
        modelSelect.appendChild(opt);
      });
    });
  }

  async start() {
    var goalInput = document.getElementById('autopilot-goal');
    if (!goalInput) return;
    var goal = goalInput.value.trim();
    if (!goal) {
      app.showToast('Please enter a goal', 'error');
      return;
    }

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
    this.shouldStop = false;

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

    try {
      var response = await fetch('/api/autopilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: provider,
          apiKey: apiKey,
          model: model,
          goal: goal,
          temperature: app.settings.temperature,
          maxTokens: app.settings.maxTokens
        })
      });

      var data = await response.json();

      if (data.success && data.steps) {
        this.steps = data.steps;
        if (stepsContainer) stepsContainer.innerHTML = '';

        data.steps.forEach(function(step, i) {
          var progress = ((i + 1) / data.steps.length * 100);
          if (progressBar) progressBar.style.width = progress + '%';

          var stepEl = document.createElement('div');
          stepEl.className = 'step-item ' + step.status;

          var iconClass = 'fa-spinner fa-spin';
          if (step.status === 'completed') iconClass = 'fa-check';
          else if (step.status === 'failed') iconClass = 'fa-times';

          var stepIconDiv = document.createElement('div');
          stepIconDiv.className = 'step-icon';
          stepIconDiv.innerHTML = '<i class="fas ' + iconClass + '"></i>';

          var stepContentDiv = document.createElement('div');
          stepContentDiv.className = 'step-content';

          var stepTitleDiv = document.createElement('div');
          stepTitleDiv.className = 'step-title';
          stepTitleDiv.textContent = 'Step ' + (i + 1) + ': ' + step.step;

          var stepResultDiv = document.createElement('div');
          stepResultDiv.className = 'step-result';
          if (step.result) {
            stepResultDiv.innerHTML = marked.parse(step.result);
          }

          stepContentDiv.appendChild(stepTitleDiv);
          stepContentDiv.appendChild(stepResultDiv);
          stepEl.appendChild(stepIconDiv);
          stepEl.appendChild(stepContentDiv);
          if (stepsContainer) stepsContainer.appendChild(stepEl);
        });

        if (resultsSection) resultsSection.style.display = 'block';
        var output = document.getElementById('autopilot-output');
        var completedSteps = data.steps.filter(function(s) { return s.status === 'completed'; }).length;

        if (output) {
          var outputHtml = '<strong>Goal:</strong> ' + goal + '<br><br>';
          outputHtml += '<strong>Completed:</strong> ' + completedSteps + '/' + data.steps.length + ' steps<br><br>';
          data.steps.forEach(function(s, i) {
            outputHtml += '<strong>Step ' + (i + 1) + ':</strong> ' + s.step + '<br>' + marked.parse(s.result || 'No result') + '<br>';
          });
          output.innerHTML = outputHtml;
        }

        app.updateStats('tasks', 1);
        app.showToast('Autopilot completed: ' + completedSteps + '/' + data.steps.length + ' steps', 'success');
        app.addActivity('Autopilot completed: ' + completedSteps + '/' + data.steps.length + ' steps');
      } else {
        app.showToast('Autopilot failed: ' + (data.error || 'Unknown error'), 'error');
      }
    } catch (err) {
      app.showToast('Autopilot error: ' + err.message, 'error');
    }

    this.isRunning = false;
    if (startBtn) startBtn.style.display = 'inline-flex';
    if (stopBtn) stopBtn.style.display = 'none';
  }

  stop() {
    this.shouldStop = true;
    this.isRunning = false;
    var startBtn = document.getElementById('autopilot-start');
    var stopBtn = document.getElementById('autopilot-stop');
    if (startBtn) startBtn.style.display = 'inline-flex';
    if (stopBtn) stopBtn.style.display = 'none';
    app.showToast('Autopilot stopped', 'warning');
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
      btn.addEventListener('click', function() {
        self.handleAction(btn.dataset.action);
      });
    });

    var copyBtn = document.getElementById('copy-output-btn');
    if (copyBtn) {
      copyBtn.addEventListener('click', function() {
        self.copyOutput();
      });
    }
  }

  async handleAction(action) {
    var inputEl = document.getElementById('codelab-input');
    if (!inputEl) return;
    var input = inputEl.value.trim();
    if (!input) {
      app.showToast('Please enter code or a description', 'error');
      return;
    }

    var provider = app.settings.defaultProvider;
    var apiKey = app.settings.getActiveKey(provider);
    if (!apiKey) {
      app.showToast('Please configure an API key in Settings', 'error');
      return;
    }

    var outputEl = document.getElementById('codelab-output');
    var copyBtn = document.getElementById('copy-output-btn');
    if (outputEl) {
      outputEl.innerHTML = '<div class="empty-state"><div class="spinner"></div><p>Processing...</p></div>';
    }
    if (copyBtn) copyBtn.style.display = 'none';

    try {
      var response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: provider,
          apiKey: apiKey,
          model: provider === 'openai' ? 'gpt-4o' : 'claude-sonnet-4-20250514',
          code: input,
          action: action,
          prompt: input,
          temperature: app.settings.temperature,
          maxTokens: app.settings.maxTokens
        })
      });

      var data = await response.json();

      if (data.success) {
        this.lastOutput = data.result;
        if (outputEl) {
          outputEl.innerHTML = marked.parse(data.result);
          outputEl.querySelectorAll('pre code').forEach(function(block) {
            hljs.highlightElement(block);
          });
        }
        if (copyBtn) copyBtn.style.display = 'flex';
        app.updateStats('messages', 1);
        app.addActivity('Code ' + action + ': completed');
      } else {
        if (outputEl) {
          outputEl.innerHTML = '<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>Error: ' + (data.error || 'Unknown error') + '</p></div>';
        }
        app.showToast('Code operation failed', 'error');
      }
    } catch (err) {
      if (outputEl) {
        outputEl.innerHTML = '<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>Error: ' + err.message + '</p></div>';
      }
      app.showToast('Network error', 'error');
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
    console.log('Octra Network AI Agent initialized');
  }

  setupNavigation() {
    var self = this;
    document.querySelectorAll('.nav-item').forEach(function(item) {
      item.addEventListener('click', function() {
        var page = item.dataset.page;
        self.navigateTo(page);
      });
    });
  }

  navigateTo(page) {
    document.querySelectorAll('.page').forEach(function(p) {
      p.classList.remove('active');
    });
    var targetPage = document.getElementById('page-' + page);
    if (targetPage) targetPage.classList.add('active');

    document.querySelectorAll('.nav-item').forEach(function(n) {
      n.classList.remove('active');
    });
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
    var icons = {
      success: 'fa-check-circle',
      error: 'fa-times-circle',
      info: 'fa-info-circle',
      warning: 'fa-exclamation-triangle'
    };
    toast.innerHTML = '<i class="fas ' + (icons[type] || icons.info) + '"></i> ' + message;
    container.appendChild(toast);
    setTimeout(function() {
      if (toast.parentNode) toast.remove();
    }, 3000);
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

    var activeProvider;
    if (this.settings.openaiKey) {
      activeProvider = this.settings.claudeKey ? 'Both' : 'OpenAI';
    } else {
      activeProvider = this.settings.claudeKey ? 'Claude' : 'None';
    }
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
    if (this.activities.length > 0) {
      var self = this;
      container.innerHTML = this.activities.slice(0, 5).map(function(a) {
        var timeAgo = self.timeAgo(a.time);
        return '<div class="activity-item"><i class="fas fa-bolt"></i><span>' + a.text + '</span><span class="time">' + timeAgo + '</span></div>';
      }).join('');
    }
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
document.addEventListener('DOMContentLoaded', function() {
  app.init();
});
