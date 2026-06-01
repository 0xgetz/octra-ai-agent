/**
 * Shared request validation helpers used by both the standalone server and the
 * serverless entrypoint. Keeping them in one place prevents the two from drifting.
 */
import { isValidProvider } from './providers.js';

export const LIMITS = {
  MAX_CODE_LEN: 50000,
  MAX_PROMPT_LEN: 10000,
  MAX_GOAL_LEN: 5000,
  MAX_MESSAGES: 200,
  MAX_DOC_LEN: 200000,
};

/** Throw a 400-tagged error. */
export function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 });
}

/**
 * Validate the common chat-style payload. Returns the cleaned fields or throws
 * a 400-tagged error.
 */
export function validateChat(body) {
  const { provider, apiKey, model, messages } = body || {};
  if (!provider || !apiKey || !model || !Array.isArray(messages)) {
    throw badRequest('Missing required fields: provider, apiKey, model, messages');
  }
  if (!isValidProvider(provider)) {
    throw badRequest(`Unsupported provider: ${provider}`);
  }
  if (messages.length === 0) throw badRequest('messages must not be empty');
  if (messages.length > LIMITS.MAX_MESSAGES) {
    throw badRequest(`Too many messages (max ${LIMITS.MAX_MESSAGES})`);
  }
  for (const m of messages) {
    if (!m || typeof m.role !== 'string' || typeof m.content !== 'string') {
      throw badRequest('Each message must have string role and content');
    }
  }
  return { provider, apiKey, model, messages };
}

export function validateAutopilot(body) {
  const { provider, apiKey, model, goal } = body || {};
  if (!provider || !apiKey || !model || !goal) {
    throw badRequest('Missing required fields: provider, apiKey, model, goal');
  }
  if (!isValidProvider(provider)) throw badRequest(`Unsupported provider: ${provider}`);
  if (typeof goal !== 'string' || goal.length > LIMITS.MAX_GOAL_LEN) {
    throw badRequest(`Goal must be a string under ${LIMITS.MAX_GOAL_LEN} chars`);
  }
  return { provider, apiKey, model, goal };
}

export function validateAnalyze(body) {
  const { provider, apiKey, model, action, code, prompt } = body || {};
  if (!provider || !apiKey || !model || !action) {
    throw badRequest('Missing required fields: provider, apiKey, model, action');
  }
  if (!isValidProvider(provider)) throw badRequest(`Unsupported provider: ${provider}`);
  if (code && code.length > LIMITS.MAX_CODE_LEN) {
    throw badRequest(`Code too long (max ${LIMITS.MAX_CODE_LEN} chars)`);
  }
  if (prompt && prompt.length > LIMITS.MAX_PROMPT_LEN) {
    throw badRequest(`Prompt too long (max ${LIMITS.MAX_PROMPT_LEN} chars)`);
  }
  return { provider, apiKey, model, action, code, prompt };
}

/** Clamp a number into [min,max] with a fallback default. */
export function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
