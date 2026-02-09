/**
 * General utility helpers.
 *
 * Mirrors rlm/utils/rlm_utils.py
 */

/**
 * Filter out sensitive keys (API keys, secrets) from a kwargs object.
 */
export function filterSensitiveKeys(
  kwargs: Record<string, unknown>
): Record<string, unknown> {
  const filtered: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(kwargs)) {
    const lower = key.toLowerCase();
    if (lower.includes("api") && lower.includes("key")) continue;
    if (lower.includes("secret")) continue;
    if (lower.includes("token") && lower.includes("auth")) continue;
    filtered[key] = value;
  }
  return filtered;
}
