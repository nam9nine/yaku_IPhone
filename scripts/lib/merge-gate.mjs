export const REQUIRED_JOBS = ['quality', 'browser', 'evidence'];

export function validateMergeResults(results) {
  const errors = [];
  if (results === null || typeof results !== 'object' || Array.isArray(results)) {
    return { valid: false, errors: ['Job results must be a JSON object.'] };
  }
  for (const job of REQUIRED_JOBS) {
    if (results[job] !== 'success')
      errors.push(
        `${job} must finish with success; received ${JSON.stringify(results[job] ?? 'missing')}.`,
      );
  }
  return { valid: errors.length === 0, errors };
}
