require('dotenv').config();

const express = require('express');
const cors = require('cors');
const https = require('https');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// In-memory sessions
// ---------------------------------------------------------------------------
const sessions = new Map();

function getOrCreateSession(sessionId) {
  if (!sessionId) {
    sessionId = uuidv4();
  }
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, {
      id: sessionId,
      createdAt: new Date().toISOString(),
      history: [],
    });
  }
  return sessions.get(sessionId);
}

// ---------------------------------------------------------------------------
// Helper: callAI  (uses Node.js native https module)
// ---------------------------------------------------------------------------
function callAI(provider, apiKey, model, messages, temperature, maxTokens) {
  return new Promise((resolve, reject) => {
    let hostname;
    let requestPath;
    let headers;
    let body;

    if (provider === 'openai') {
      hostname = 'api.openai.com';
      requestPath = '/v1/chat/completions';
      headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      };
      body = JSON.stringify({
        model: model,
        messages: messages,
        temperature: temperature !== undefined ? temperature : 0.7,
        max_tokens: maxTokens !== undefined ? maxTokens : 2048,
      });
    } else if (provider === 'claude') {
      hostname = 'api.anthropic.com';
      requestPath = '/v1/messages';

      // Claude expects system messages as a top-level "system" param,
      // not inside the messages array.
      let systemPrompt = '';
      const filteredMessages = [];
      for (const msg of messages) {
        if (msg.role === 'system') {
          systemPrompt += (systemPrompt ? '\n' : '') + msg.content;
        } else {
          filteredMessages.push({ role: msg.role, content: msg.content });
        }
      }

      headers = {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      };

      const claudeBody = {
        model: model,
        messages: filteredMessages,
        max_tokens: maxTokens !== undefined ? maxTokens : 2048,
        temperature: temperature !== undefined ? temperature : 0.7,
      };
      if (systemPrompt) {
        claudeBody.system = systemPrompt;
      }
      body = JSON.stringify(claudeBody);
    } else {
      return reject(new Error(`Unsupported provider: ${provider}`));
    }

    const options = {
      hostname: hostname,
      port: 443,
      path: requestPath,
      method: 'POST',
      headers: {
        ...headers,
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      const chunks = [];

      res.on('data', (chunk) => {
        chunks.push(chunk);
      });

      res.on('end', () => {
        const rawBody = Buffer.concat(chunks).toString('utf-8');
        let parsed;
        try {
          parsed = JSON.parse(rawBody);
        } catch (parseErr) {
          return reject(new Error(`Failed to parse ${provider} response: ${rawBody.substring(0, 500)}`));
        }

        if (res.statusCode < 200 || res.statusCode >= 300) {
          const errMsg =
            parsed.error?.message ||
            parsed.error?.type ||
            parsed.message ||
            JSON.stringify(parsed);
          return reject(new Error(`${provider} API error (${res.statusCode}): ${errMsg}`));
        }

        resolve(parsed);
      });
    });

    req.on('error', (err) => {
      reject(new Error(`Network error calling ${provider}: ${err.message}`));
    });

    req.write(body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Helper: normalize AI response to a common shape
// ---------------------------------------------------------------------------
function normalizeResponse(provider, raw) {
  if (provider === 'openai') {
    const choice = raw.choices && raw.choices[0];
    return {
      message: {
        role: 'assistant',
        content: choice ? choice.message.content : '',
      },
      usage: raw.usage
        ? {
            prompt_tokens: raw.usage.prompt_tokens || 0,
            completion_tokens: raw.usage.completion_tokens || 0,
            total_tokens: raw.usage.total_tokens || 0,
          }
        : { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    };
  }

  if (provider === 'claude') {
    // Claude returns content as an array of content blocks
    let text = '';
    if (Array.isArray(raw.content)) {
      text = raw.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('');
    } else if (typeof raw.content === 'string') {
      text = raw.content;
    }

    return {
      message: {
        role: 'assistant',
        content: text,
      },
      usage: raw.usage
        ? {
            prompt_tokens: raw.usage.input_tokens || 0,
            completion_tokens: raw.usage.output_tokens || 0,
            total_tokens:
              (raw.usage.input_tokens || 0) + (raw.usage.output_tokens || 0),
          }
        : { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    };
  }

  return {
    message: { role: 'assistant', content: '' },
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

// ---------------------------------------------------------------------------
// POST /api/chat
// ---------------------------------------------------------------------------
app.post('/api/chat', async (req, res) => {
  try {
    const { provider, apiKey, model, messages, temperature, maxTokens } = req.body;

    if (!provider || !apiKey || !model || !messages || !Array.isArray(messages)) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: provider, apiKey, model, messages',
      });
    }

    const raw = await callAI(provider, apiKey, model, messages, temperature, maxTokens);
    const normalized = normalizeResponse(provider, raw);

    return res.json({
      success: true,
      message: normalized.message,
      usage: normalized.usage,
    });
  } catch (err) {
    console.error('[/api/chat] Error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/autopilot
// ---------------------------------------------------------------------------
app.post('/api/autopilot', async (req, res) => {
  try {
    const { provider, apiKey, model, goal, temperature, maxTokens } = req.body;

    if (!provider || !apiKey || !model || !goal) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: provider, apiKey, model, goal',
      });
    }

    // Step 1 -- Ask AI to decompose the goal into steps
    const planMessages = [
      {
        role: 'system',
        content:
          'You are a task-planning assistant. The user will give you a goal. ' +
          'Break it down into 3 to 7 clear, actionable numbered steps. ' +
          'Respond ONLY with a JSON array of step strings. ' +
          'Example: ["Step one description", "Step two description", "Step three description"]. ' +
          'Do not include any other text, explanation, or markdown formatting -- just the raw JSON array.',
      },
      {
        role: 'user',
        content: goal,
      },
    ];

    const planRaw = await callAI(provider, apiKey, model, planMessages, temperature, maxTokens);
    const planNormalized = normalizeResponse(provider, planRaw);
    const planText = planNormalized.message.content.trim();

    // Step 2 -- Parse the steps
    let steps;
    try {
      // Try to extract JSON array from the response (handle markdown fencing)
      let jsonStr = planText;
      const jsonMatch = planText.match(/\[\s*[\s\S]*?\]/); 
      if (jsonMatch) {
        jsonStr = jsonMatch[0];
      }
      steps = JSON.parse(jsonStr);
      if (!Array.isArray(steps)) {
        throw new Error('Parsed value is not an array');
      }
    } catch (parseErr) {
      // Fallback: split numbered lines
      steps = planText
        .split('\n')
        .map((line) => line.replace(/^\d+[\.\)\-]\s*/, '').trim())
        .filter((line) => line.length > 0);
      if (steps.length === 0) {
        steps = [planText];
      }
    }

    // Step 3 -- Execute each step sequentially
    const results = [];
    let previousResults = '';

    for (let i = 0; i < steps.length; i++) {
      const stepText = steps[i];
      let contextMessage = `Original goal: ${goal}\n\nCurrent step (${i + 1} of ${steps.length}): ${stepText}`;
      if (previousResults) {
        contextMessage += `\n\nPrevious step results:\n${previousResults}`;
      }

      const stepMessages = [
        {
          role: 'system',
          content:
            'You are an AI executing a specific step of a larger plan. ' +
            'Complete the given step thoroughly and provide a clear, detailed result. ' +
            'Focus only on the current step while keeping the overall goal in mind.',
        },
        {
          role: 'user',
          content: contextMessage,
        },
      ];

      try {
        const stepRaw = await callAI(provider, apiKey, model, stepMessages, temperature, maxTokens);
        const stepNormalized = normalizeResponse(provider, stepRaw);
        const stepResult = stepNormalized.message.content;

        results.push({
          step: stepText,
          result: stepResult,
          status: 'completed',
        });

        previousResults += `\nStep ${i + 1} (${stepText}): ${stepResult.substring(0, 500)}`;
      } catch (stepErr) {
        results.push({
          step: stepText,
          result: stepErr.message,
          status: 'failed',
        });

        previousResults += `\nStep ${i + 1} (${stepText}): FAILED - ${stepErr.message}`;
      }
    }

    return res.json({
      success: true,
      goal: goal,
      steps: results,
    });
  } catch (err) {
    console.error('[/api/autopilot] Error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/analyze
// ---------------------------------------------------------------------------
app.post('/api/analyze', async (req, res) => {
  try {
    const { provider, apiKey, model, code, action, prompt, temperature, maxTokens } = req.body;

    if (!provider || !apiKey || !model || !action) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: provider, apiKey, model, action',
      });
    }

    // Build the system prompt based on the action type
    const systemPrompts = {
      analyze:
        'You are an expert code analyst. Analyze the provided code thoroughly. ' +
        'Identify potential bugs, performance issues, security vulnerabilities, ' +
        'and areas for improvement. Provide a structured analysis with clear categories ' +
        'and actionable recommendations.',
      refactor:
        'You are an expert software engineer specializing in code refactoring. ' +
        'Refactor the provided code to improve readability, performance, and maintainability. ' +
        'Follow best practices and design patterns. Provide the refactored code with ' +
        'explanations for each change you made.',
      explain:
        'You are a patient and thorough programming teacher. Explain the provided code ' +
        'in detail. Break down what each section does, explain the logic flow, ' +
        'and describe any patterns or techniques used. Make your explanation accessible ' +
        'to developers of all skill levels.',
      generate:
        'You are an expert software developer and code generator. Generate clean, ' +
        'well-documented, production-ready code based on the user\'s requirements. ' +
        'Include helpful comments, error handling, and follow best practices for the ' +
        'relevant language or framework.',
    };

    const systemContent = systemPrompts[action] || systemPrompts.analyze;

    // Build the user message
    let userContent = '';
    if (code) {
      userContent += `Code:\n\`\`\`\n${code}\n\`\`\`\n\n`;
    }
    if (prompt) {
      userContent += `Additional instructions: ${prompt}`;
    }
    if (!userContent) {
      userContent = 'Please provide analysis based on the action type.';
    }

    const messages = [
      { role: 'system', content: systemContent },
      { role: 'user', content: userContent },
    ];

    const raw = await callAI(provider, apiKey, model, messages, temperature, maxTokens);
    const normalized = normalizeResponse(provider, raw);

    return res.json({
      success: true,
      result: normalized.message.content,
      action: action,
    });
  } catch (err) {
    console.error('[/api/analyze] Error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/health
// ---------------------------------------------------------------------------
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`Octra Network AI Agent running on http://localhost:${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});
