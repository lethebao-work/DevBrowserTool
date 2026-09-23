/**
 * Actions Module — Re-exports
 */
export {
  type BrowserAdapter,
  type ActionContext,
  type ActionResult,
  type ActionPrimitive,
  NavigateAction,
  ClickAction,
  FillAction,
  CallApiAction,
  ExtractAction,
  ActionRegistry,
  sanitizeForLLM,
} from './primitives.js';

export * from './advanced.js';
export * from './phase3-primitives.js';
export * from './stealth.js';
export * from './stealth-driver.js';

