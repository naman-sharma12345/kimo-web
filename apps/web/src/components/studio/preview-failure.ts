/** Only bounded exception names/messages, never stacks or arbitrary object fields. */
export function previewFailure(reason: unknown): {
  status: 'unavailable' | 'error';
  details: string;
} {
  const seen = new Set<unknown>();
  const lines: string[] = [];
  const visit = (value: unknown, depth: number) => {
    if (depth > 4 || lines.length >= 10 || seen.has(value)) return;
    seen.add(value);
    let text =
      value instanceof Error
        ? `${value.name}: ${value.message}`
        : typeof value === 'string'
          ? value
          : 'Unknown initialization error';
    text = text
      .replace(/(?:https?|wss?|file):\/\/[^\s]+/gi, '[URL redacted]')
      .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
      .replace(
        /(token|password|secret|authorization|cookie|api[_-]?key)["']?\s*[:=]\s*["']?[^\s,;"']+/gi,
        '$1=[redacted]',
      )
      .replace(/\p{Cc}/gu, ' ')
      .slice(0, 400);
    lines.push(`${'  '.repeat(depth)}${text}`);
    if (value instanceof AggregateError)
      for (const error of value.errors.slice(0, 10)) visit(error, depth + 1);
    if (value instanceof Error && value.cause !== undefined)
      visit(value.cause, depth + 1);
  };
  visit(reason, 0);
  const details = lines.join('\n');
  return {
    status: /No available renderer|adapter unavailable/i.test(details)
      ? 'unavailable'
      : 'error',
    details,
  };
}
