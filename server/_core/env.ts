export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  // Mercado Livre OAuth
  mlAppId: process.env.ML_APP_ID ?? "",
  mlClientSecret: process.env.ML_CLIENT_SECRET ?? "",
  // TikTok Shop
  tiktokAppKey: process.env.TIKTOK_APP_KEY ?? "",
  tiktokAppSecret: process.env.TIKTOK_APP_SECRET ?? "",
  // Amazon SP-API
  amazonClientId: process.env.AMAZON_CLIENT_ID ?? "",
  amazonClientSecret: process.env.AMAZON_CLIENT_SECRET ?? "",
  // Shopee Open Platform
  shopeePartnerId: process.env.SHOPEE_PARTNER_ID ?? "",
  shopeePartnerKey: process.env.SHOPEE_PARTNER_KEY ?? "",
  // Google Gemini API
  geminiApiKey: process.env.GEMINI_API_KEY ?? "",
  geminiApiKey2: process.env.GEMINI_API_KEY_2 ?? "",
  // Groq
  groqApiKey: process.env.GROQ_API_KEY ?? "",
  // Anthropic Claude
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  // OpenAI
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",
  // Provedor de IA ativo (anthropic | groq | openai | gemini | forge)
  aiProvider: process.env.AI_PROVIDER ?? "",
};
