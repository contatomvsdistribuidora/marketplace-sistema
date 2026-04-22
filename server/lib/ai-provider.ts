/**
 * Função universal de geração de texto por IA.
 * Usa o provedor configurado nas Settings (banco) ou AI_PROVIDER env var.
 *
 * Provedores suportados:
 *   "anthropic" → ANTHROPIC_API_KEY + claude-sonnet-4-20250514
 *   "groq"      → GROQ_API_KEY + llama-3.3-70b-versatile
 *   "openai"    → OPENAI_API_KEY + gpt-4o-mini
 *   "gemini"    → GEMINI_API_KEY + gemini-2.0-flash-lite
 *   "forge"     → BUILT_IN_FORGE_API_KEY (fallback interno)
 */

import { invokeLLM, setRuntimeAiProvider } from "../_core/llm";
import { db } from "../db";

let _initialized = false;

async function ensureInitialized() {
  if (_initialized) return;
  _initialized = true;
  try {
    // Tenta carregar provedor salvo no banco (userId=1 é o admin/único usuário)
    const { settings } = await import("../../drizzle/schema");
    const { eq, and } = await import("drizzle-orm");
    const [providerRow] = await db.select()
      .from(settings)
      .where(and(eq(settings.settingKey, "ai_provider")))
      .limit(1);
    const [keyRow] = await db.select()
      .from(settings)
      .where(and(eq(settings.settingKey, "ai_api_key")))
      .limit(1);
    if (providerRow?.settingValue) {
      setRuntimeAiProvider(providerRow.settingValue, keyRow?.settingValue ?? "");
    }
  } catch {
    // Silencioso — usa fallback env vars
  }
}

/**
 * Gera texto a partir de um prompt simples usando o provedor de IA ativo.
 */
export async function generateText(prompt: string): Promise<string> {
  await ensureInitialized();
  const result = await invokeLLM({
    messages: [{ role: "user", content: prompt }],
  });
  const content = result.choices[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((p): p is { type: "text"; text: string } => p.type === "text")
      .map(p => p.text)
      .join("");
  }
  return "";
}

/**
 * Garante que o provedor de IA está carregado do banco.
 * Exportado para ser chamado por módulos que usam invokeLLM diretamente.
 */
export async function loadAiProviderFromDb(): Promise<void> {
  await ensureInitialized();
}

/**
 * Recarrega configuração do banco (chama após salvar novas settings).
 */
export function resetAiProviderCache() {
  _initialized = false;
}
