import { GoogleGenerativeAI } from "@google/generative-ai";
import OpenAI from "openai";
import { ENV } from "./env";

export type Role = "system" | "user" | "assistant" | "tool" | "function";

export type TextContent = {
  type: "text";
  text: string;
};

export type ImageContent = {
  type: "image_url";
  image_url: {
    url: string;
    detail?: "auto" | "low" | "high";
  };
};

export type FileContent = {
  type: "file_url";
  file_url: {
    url: string;
    mime_type?: "audio/mpeg" | "audio/wav" | "application/pdf" | "audio/mp4" | "video/mp4" ;
  };
};

export type MessageContent = string | TextContent | ImageContent | FileContent;

export type Message = {
  role: Role;
  content: MessageContent | MessageContent[];
  name?: string;
  tool_call_id?: string;
};

export type Tool = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
};

export type ToolChoicePrimitive = "none" | "auto" | "required";
export type ToolChoiceByName = { name: string };
export type ToolChoiceExplicit = {
  type: "function";
  function: {
    name: string;
  };
};

export type ToolChoice =
  | ToolChoicePrimitive
  | ToolChoiceByName
  | ToolChoiceExplicit;

export type InvokeParams = {
  messages: Message[];
  tools?: Tool[];
  toolChoice?: ToolChoice;
  tool_choice?: ToolChoice;
  maxTokens?: number;
  max_tokens?: number;
  outputSchema?: OutputSchema;
  output_schema?: OutputSchema;
  responseFormat?: ResponseFormat;
  response_format?: ResponseFormat;
};

export type ToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export type InvokeResult = {
  id: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: Role;
      content: string | Array<TextContent | ImageContent | FileContent>;
      tool_calls?: ToolCall[];
    };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

export type JsonSchema = {
  name: string;
  schema: Record<string, unknown>;
  strict?: boolean;
};

export type OutputSchema = JsonSchema;

export type ResponseFormat =
  | { type: "text" }
  | { type: "json_object" }
  | { type: "json_schema"; json_schema: JsonSchema };

// ============ HELPERS ============

const extractMessageText = (content: MessageContent | MessageContent[]): string => {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((p) => (typeof p === "string" ? p : p.type === "text" ? p.text : ""))
      .join("\n");
  }
  if (content.type === "text") return content.text;
  return "";
};

// ============ GEMINI ============

const GEMINI_MODEL = "gemini-2.0-flash-lite";

const invokeGeminiWithKey = async (apiKey: string, params: InvokeParams): Promise<InvokeResult> => {
  const { messages, maxTokens, max_tokens, responseFormat, response_format } = params;

  const genAI = new GoogleGenerativeAI(apiKey);

  const systemInstruction = messages
    .filter((m) => m.role === "system")
    .map((m) => extractMessageText(m.content))
    .join("\n") || undefined;

  const isJsonMode =
    responseFormat?.type === "json_schema" ||
    responseFormat?.type === "json_object" ||
    response_format?.type === "json_schema" ||
    response_format?.type === "json_object";

  const model = genAI.getGenerativeModel({
    model: GEMINI_MODEL,
    ...(systemInstruction ? { systemInstruction } : {}),
    generationConfig: {
      maxOutputTokens: maxTokens || max_tokens || 8192,
      ...(isJsonMode ? { responseMimeType: "application/json" } : {}),
    },
  });

  const nonSystemMessages = messages.filter((m) => m.role !== "system");
  const history = nonSystemMessages.slice(0, -1).map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: extractMessageText(m.content) }],
  }));

  const lastMessage = nonSystemMessages[nonSystemMessages.length - 1];
  const lastText = lastMessage ? extractMessageText(lastMessage.content) : "";

  const chat = model.startChat({ history });
  const result = await chat.sendMessage(lastText);
  const text = result.response.text();

  return {
    id: `gemini-${Date.now()}`,
    created: Math.floor(Date.now() / 1000),
    model: GEMINI_MODEL,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: text },
        finish_reason: result.response.candidates?.[0]?.finishReason ?? "stop",
      },
    ],
    usage: result.response.usageMetadata
      ? {
          prompt_tokens: result.response.usageMetadata.promptTokenCount ?? 0,
          completion_tokens: result.response.usageMetadata.candidatesTokenCount ?? 0,
          total_tokens: result.response.usageMetadata.totalTokenCount ?? 0,
        }
      : undefined,
  };
};

// ============ FORGE (fallback) ============

const ensureArray = (
  value: MessageContent | MessageContent[]
): MessageContent[] => (Array.isArray(value) ? value : [value]);

const normalizeContentPart = (
  part: MessageContent
): TextContent | ImageContent | FileContent => {
  if (typeof part === "string") return { type: "text", text: part };
  if (part.type === "text") return part;
  if (part.type === "image_url") return part;
  if (part.type === "file_url") return part;
  throw new Error("Unsupported message content part");
};

const normalizeMessage = (message: Message) => {
  const { role, name, tool_call_id } = message;

  if (role === "tool" || role === "function") {
    const content = ensureArray(message.content)
      .map(part => (typeof part === "string" ? part : JSON.stringify(part)))
      .join("\n");
    return { role, name, tool_call_id, content };
  }

  const contentParts = ensureArray(message.content).map(normalizeContentPart);

  if (contentParts.length === 1 && contentParts[0].type === "text") {
    return { role, name, content: contentParts[0].text };
  }

  return { role, name, content: contentParts };
};

const normalizeToolChoice = (
  toolChoice: ToolChoice | undefined,
  tools: Tool[] | undefined
): "none" | "auto" | ToolChoiceExplicit | undefined => {
  if (!toolChoice) return undefined;
  if (toolChoice === "none" || toolChoice === "auto") return toolChoice;
  if (toolChoice === "required") {
    if (!tools || tools.length === 0) throw new Error("tool_choice 'required' was provided but no tools were configured");
    if (tools.length > 1) throw new Error("tool_choice 'required' needs a single tool or specify the tool name explicitly");
    return { type: "function", function: { name: tools[0].function.name } };
  }
  if ("name" in toolChoice) return { type: "function", function: { name: toolChoice.name } };
  return toolChoice;
};

const resolveApiUrl = () =>
  ENV.forgeApiUrl && ENV.forgeApiUrl.trim().length > 0
    ? `${ENV.forgeApiUrl.replace(/\/$/, "")}/v1/chat/completions`
    : "https://forge.manus.im/v1/chat/completions";

const invokeForge = async (params: InvokeParams): Promise<InvokeResult> => {
  const { messages, tools, toolChoice, tool_choice, outputSchema, output_schema, responseFormat, response_format } = params;

  const payload: Record<string, unknown> = {
    model: "gemini-2.5-flash",
    messages: messages.map(normalizeMessage),
    max_tokens: 8192,
  };

  if (tools && tools.length > 0) payload.tools = tools;

  const normalizedToolChoice = normalizeToolChoice(toolChoice || tool_choice, tools);
  if (normalizedToolChoice) payload.tool_choice = normalizedToolChoice;

  const explicitFormat = responseFormat || response_format;
  const schema = outputSchema || output_schema;
  if (explicitFormat) {
    payload.response_format = explicitFormat;
  } else if (schema) {
    payload.response_format = { type: "json_schema", json_schema: schema };
  }

  const response = await fetch(resolveApiUrl(), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${ENV.forgeApiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`LLM invoke failed: ${response.status} ${response.statusText} – ${errorText}`);
  }

  return (await response.json()) as InvokeResult;
};

// ============ GROQ ============

const invokeGroq = async (params: InvokeParams): Promise<InvokeResult> => {
  const { messages, tools, toolChoice, tool_choice, outputSchema, output_schema, responseFormat, response_format, maxTokens, max_tokens } = params;

  const client = new OpenAI({
    apiKey: ENV.groqApiKey,
    baseURL: "https://api.groq.com/openai/v1",
  });

  const payload: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
    model: "llama-3.3-70b-versatile",
    messages: messages.map(normalizeMessage) as OpenAI.Chat.ChatCompletionMessageParam[],
    max_tokens: 500,
  };

  if (tools && tools.length > 0) payload.tools = tools as OpenAI.Chat.ChatCompletionTool[];

  const normalizedToolChoice = normalizeToolChoice(toolChoice || tool_choice, tools);
  if (normalizedToolChoice) payload.tool_choice = normalizedToolChoice as OpenAI.Chat.ChatCompletionToolChoiceOption;

  const explicitFormat = responseFormat || response_format;
  const schema = outputSchema || output_schema;
  const wantsJson = schema ||
    explicitFormat?.type === "json_schema" ||
    explicitFormat?.type === "json_object";

  if (wantsJson) {
    payload.response_format = { type: "json_object" } as OpenAI.ResponseFormatJSONObject;
  }

  const response = await client.chat.completions.create(payload);
  return response as unknown as InvokeResult;
};

// ============ PUBLIC API ============

const isQuotaError = (err: unknown): boolean => {
  const msg = String(err);
  return msg.includes("429") || msg.includes("Too Many Requests") || msg.includes("RESOURCE_EXHAUSTED");
};

export async function invokeLLM(params: InvokeParams): Promise<InvokeResult> {
  // 1. Groq (principal)
  if (ENV.groqApiKey) {
    try {
      return await invokeGroq(params);
    } catch (err) {
      if (!isQuotaError(err)) throw err;
      console.warn("[LLM] Groq quota exceeded, trying Gemini key 1");
    }
  }

  // 2. Gemini chave 1
  if (ENV.geminiApiKey) {
    try {
      return await invokeGeminiWithKey(ENV.geminiApiKey, params);
    } catch (err) {
      if (!isQuotaError(err)) throw err;
      console.warn("[LLM] Gemini key 1 quota exceeded, trying Gemini key 2");
    }
  }

  // 3. Gemini chave 2
  if (ENV.geminiApiKey2) {
    try {
      return await invokeGeminiWithKey(ENV.geminiApiKey2, params);
    } catch (err) {
      if (!isQuotaError(err)) throw err;
      console.warn("[LLM] Gemini key 2 quota exceeded, falling back to Forge");
    }
  }

  // 4. Forge
  if (ENV.forgeApiKey) {
    return invokeForge(params);
  }

  throw new Error("No LLM provider available. Configure GROQ_API_KEY or GEMINI_API_KEY in .env.");
}
