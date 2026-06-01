/**
 * Multi-agent autopilot engine.
 *
 * Beyond the original linear "plan then run each step" approach, this engine:
 *   1. Plans the goal into steps.
 *   2. Executes each step (optionally with tool access via the agent loop).
 *   3. Runs a self-critique on each step result; if the critique fails and
 *      retries remain, it revises and re-executes.
 *   4. After all steps, can replan once if the critic judges the goal unmet.
 *
 * Everything is bounded by a token/step budget so a runaway goal can't loop
 * forever or silently burn the user's API credits.
 */
import { callAI } from './providers.js';
import { runAgentLoop } from './tools.js';

const PLANNER_SYSTEM =
  'You are a task-planning assistant. Break the goal into 3-7 clear, actionable numbered steps. Respond ONLY with a JSON array of step strings. No markdown, no explanation.';

const EXECUTOR_SYSTEM =
  'You are an AI executing a specific step of a larger plan. Complete the step thoroughly. Focus on the current step while keeping the overall goal in mind.';

const CRITIC_SYSTEM =
  'You are a strict quality reviewer. Given a step and its result, decide if the result adequately completes the step. Respond ONLY with JSON: {"pass": true|false, "reason": "...", "suggestion": "concrete improvement if failed"}.';

function parsePlan(text) {
  const trimmed = text.trim();
  try {
    const match = trimmed.match(/\[[\s\S]*?\]/);
    const steps = JSON.parse(match ? match[0] : trimmed);
    if (Array.isArray(steps) && steps.length) return steps.map((s) => String(s));
  } catch {
    // fall through to line parsing
  }
  const lines = trimmed
    .split('\n')
    .map((l) => l.replace(/^\s*\d+[.)-]\s*/, '').trim())
    .filter(Boolean);
  return lines.length ? lines : [trimmed];
}

function parseCritique(text) {
  try {
    const match = text.match(/\{[\s\S]*\}/);
    const obj = JSON.parse(match ? match[0] : text);
    return { pass: !!obj.pass, reason: obj.reason || '', suggestion: obj.suggestion || '' };
  } catch {
    // If the critic didn't return JSON, treat a lenient default as pass.
    return { pass: true, reason: 'critique unparseable; accepted by default', suggestion: '' };
  }
}

/**
 * @param {object} cfg
 * @param {string} cfg.provider @param {string} cfg.apiKey @param {string} cfg.model
 * @param {string} cfg.goal
 * @param {object} [cfg.options] { temperature, maxTokens, useTools, maxRetries, selfCritique, tokenBudget }
 * @param {AbortSignal} [cfg.signal]
 * @param {(event:string,data:object)=>void} [cfg.emit]
 */
export async function runAutopilot({ provider, apiKey, model, goal, options = {}, signal, emit = () => {} }) {
  const {
    temperature = 0.7,
    maxTokens = 2048,
    useTools = false,
    maxRetries = 1,
    selfCritique = true,
    tokenBudget = 100000,
  } = options;

  const usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  const addUsage = (u) => {
    usage.prompt_tokens += u.prompt_tokens || 0;
    usage.completion_tokens += u.completion_tokens || 0;
    usage.total_tokens += u.total_tokens || 0;
  };
  const budgetExceeded = () => usage.total_tokens >= tokenBudget;

  const ask = async (system, user) => {
    const res = await callAI(provider, apiKey, model, [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ], { temperature, maxTokens, signal });
    addUsage(res.usage);
    return res.message.content;
  };

  const executeStep = async (stepText, contextStr) => {
    if (useTools) {
      const r = await runAgentLoop({
        provider, apiKey, model,
        query: `${contextStr}\n\nComplete this step: ${stepText}`,
        temperature, maxTokens, maxSteps: 4, signal,
      });
      addUsage(r.usage);
      return { content: r.answer, toolSteps: r.steps };
    }
    const content = await ask(EXECUTOR_SYSTEM, `${contextStr}\n\nCurrent step: ${stepText}`);
    return { content, toolSteps: [] };
  };

  // ---- Plan ----
  emit('status', { message: 'Planning steps...' });
  const planText = await ask(PLANNER_SYSTEM, goal);
  let steps = parsePlan(planText);
  emit('plan', { steps });

  const results = [];
  let previousResults = '';
  let replanned = false;

  for (let i = 0; i < steps.length; i++) {
    if (signal?.aborted) { emit('cancelled', { message: 'Run cancelled by user' }); break; }
    if (budgetExceeded()) { emit('budget', { message: `Token budget (${tokenBudget}) reached; stopping.`, usage }); break; }

    const stepText = steps[i];
    emit('step_start', { index: i, step: stepText, total: steps.length });

    let ctx = `Original goal: ${goal}\n\nStep ${i + 1}/${steps.length}: ${stepText}`;
    if (previousResults) ctx += `\n\nPrevious results:\n${previousResults}`;

    let attempt = 0;
    let stepContent = '';
    let toolSteps = [];
    let critique = { pass: true, reason: '', suggestion: '' };
    let status = 'completed';

    while (attempt <= maxRetries) {
      if (signal?.aborted) break;
      try {
        const exec = await executeStep(attempt === 0 ? stepText : `${stepText}\n\nReviewer feedback to address: ${critique.suggestion}`, ctx);
        stepContent = exec.content;
        toolSteps = exec.toolSteps;
      } catch (err) {
        if (err.name === 'AbortError') { status = 'cancelled'; break; }
        stepContent = err.message;
        status = 'failed';
        break;
      }

      if (!selfCritique || budgetExceeded()) break;
      const critRaw = await ask(CRITIC_SYSTEM, `Step: ${stepText}\n\nResult:\n${stepContent}`);
      critique = parseCritique(critRaw);
      emit('critique', { index: i, attempt, pass: critique.pass, reason: critique.reason });
      if (critique.pass) break;
      attempt++;
      if (attempt > maxRetries) { status = 'completed_with_warnings'; break; }
      emit('retry', { index: i, attempt, suggestion: critique.suggestion });
    }

    if (status === 'cancelled') { emit('cancelled', { message: 'Run cancelled by user' }); break; }

    results.push({ step: stepText, result: stepContent, status, toolSteps, critique });
    previousResults += `\nStep ${i + 1} (${stepText}) [${status}]:\n${stepContent}\n`;
    emit('step_done', { index: i, step: stepText, result: stepContent, status, toolSteps });

    // ---- One-shot replan if this is the last step and the goal looks unmet ----
    if (selfCritique && !replanned && i === steps.length - 1 && !budgetExceeded() && !signal?.aborted) {
      const verdictRaw = await ask(
        CRITIC_SYSTEM,
        `Goal: ${goal}\n\nAll step results so far:\n${previousResults}\n\nIs the overall goal fully achieved?`,
      );
      const verdict = parseCritique(verdictRaw);
      if (!verdict.pass && verdict.suggestion) {
        replanned = true;
        emit('replan', { reason: verdict.reason, suggestion: verdict.suggestion });
        const extraText = await ask(PLANNER_SYSTEM, `${goal}\n\nAlready done:\n${previousResults}\n\nRemaining work needed: ${verdict.suggestion}`);
        const extraSteps = parsePlan(extraText);
        steps = steps.concat(extraSteps);
        emit('plan', { steps });
      }
    }
  }

  if (!signal?.aborted) emit('complete', { goal, steps: results, usage });
  return { goal, steps: results, usage, replanned };
}
