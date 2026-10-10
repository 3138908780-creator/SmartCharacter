/** Connection headers/addresses are not captured; the current key is redacted. Records live only in service memory. */
export function failureDiagnostic(context, message, secret) {
  const replacements = secret ? [secret, JSON.stringify(secret).slice(1, -1), [...secret].map(c => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`).join("")] : [];
  function clean(value) {
    if (typeof value === "string") return replacements.reduce((text, key) => text.split(key).join("[已隐藏密钥]"), value);
    if (Array.isArray(value)) return value.map(clean);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([key]) => !/^(apiKey|authorization|accessToken|token)$/i.test(key)).map(([key, item]) => [clean(key), clean(item)]));
    return value;
  }
  let response = context.content ?? null;
  if (typeof response === "string") { try { response = JSON.parse(response); } catch {} }
  const usage = {};
  for (const [name, value] of Object.entries({ promptTokens: context.usage?.prompt_tokens, completionTokens: context.usage?.completion_tokens, reasoningTokens: context.usage?.completion_tokens_details?.reasoning_tokens })) if (Number.isFinite(value) && value >= 0) usage[name] = value;
  return clean({ version: 1, remoteProtocol: 3, kind: context.kind, recordedAt: new Date().toISOString(), batch: context.batch ?? 1, message, finishReason: context.finishReason ?? null, usage, subtitles: context.cues, response });
}
