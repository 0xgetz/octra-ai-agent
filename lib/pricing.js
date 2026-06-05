/**
 * Token pricing tables + cost estimation.
 *
 * Prices are in USD per 1,000,000 tokens and are approximate public list
 * prices, not billing-accurate. They are easy to override at runtime via
 * setPrice() so deployments can keep them current without a code change.
 */

export const PRICING = {
  'openai:gpt-4o': { input: 2.5, output: 10 },
  'openai:gpt-4o-mini': { input: 0.15, output: 0.6 },
  'openai:gpt-4-turbo': { input: 10, output: 30 },
  'openai:gpt-4': { input: 30, output: 60 },
  'openai:gpt-3.5-turbo': { input: 0.5, output: 1.5 },
  'claude:claude-opus-4-5': { input: 5, output: 25 },
  'claude:claude-sonnet-4-5': { input: 3, output: 15 },
  'claude:claude-3-5-haiku-20241022': { input: 0.8, output: 4 },
  'claude:claude-3-opus-20240229': { input: 15, output: 75 },
  'gemini:gemini-2.5-pro': { input: 1.25, output: 10 },
  'gemini:gemini-2.5-flash': { input: 0.3, output: 2.5 },
  'gemini:gemini-2.0-flash': { input: 0.1, output: 0.4 },
  'gemini:gemini-1.5-pro': { input: 1.25, output: 5 },
  'groq:llama-3.3-70b-versatile': { input: 0.59, output: 0.79 },
  'groq:llama-3.1-8b-instant': { input: 0.05, output: 0.08 },
};

function round6(n) {
  return Math.round(n * 1e6) / 1e6;
}

/** Override or add a price entry (USD per 1M tokens). */
export function setPrice(provider, model, input, output) {
  PRICING[`${provider}:${model}`] = { input, output };
  return PRICING[`${provider}:${model}`];
}

/** Look up the price entry for a provider:model, or null if unknown. */
export function getPrice(provider, model) {
  return PRICING[`${provider}:${model}`] || null;
}

/**
 * Estimate the USD cost of a completion given its token usage.
 * Unknown models return a zero-cost result flagged with known:false instead of
 * throwing, so callers can always annotate a response.
 */
export function estimateCost(provider, model, usage = {}) {
  const promptTokens = usage.prompt_tokens || 0;
  const completionTokens = usage.completion_tokens || 0;
  const price = getPrice(provider, model);
  if (!price) {
    return {
      provider, model, known: false,
      promptTokens, completionTokens,
      inputCost: 0, outputCost: 0, totalCost: 0, currency: 'USD',
    };
  }
  const inputCost = (promptTokens / 1e6) * price.input;
  const outputCost = (completionTokens / 1e6) * price.output;
  return {
    provider, model, known: true,
    promptTokens, completionTokens,
    inputCost: round6(inputCost),
    outputCost: round6(outputCost),
    totalCost: round6(inputCost + outputCost),
    currency: 'USD',
  };
}
