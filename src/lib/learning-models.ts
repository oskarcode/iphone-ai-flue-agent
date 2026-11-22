import { createAI } from "agents/models/pi-ai";
import { createModels } from "@earendil-works/pi-ai";

// Explicit, reviewed catalog. No user-supplied provider IDs reach the AI binding.
// Kimi K3 is a third-party AI Gateway model (Unified Billing), not the retired @cf/ Kimi K2 models.
export const LEARNING_MODELS = [
  { id: "@cf/zai-org/glm-5.3", name: "GLM-5.3", description: "Default · long-context learning and coding", source: "https://developers.cloudflare.com/workers-ai/models/glm-5.3/" },
  { id: "moonshotai/kimi-k3", name: "Kimi K3", description: "Deep learning and code · AI Gateway billing", source: "https://developers.cloudflare.com/ai/models/moonshotai/kimi-k3/" },
  { id: "@cf/deepseek-ai/deepseek-v4.1-flash-1017", name: "DeepSeek V4.1 Flash", description: "Fast, capable coding and tool use", source: "https://developers.cloudflare.com/workers-ai/models/deepseek-v4.1-flash-1017/" },
  { id: "@cf/google/gemma-4-26b-a4b-it", name: "Gemma 4 26B", description: "Efficient multilingual explanations", source: "https://developers.cloudflare.com/workers-ai/models/gemma-4-26b-a4b-it/" },
  { id: "@cf/qwen/qwen3.8-27b", name: "Qwen 3.8 27B", description: "Compact reasoning and code", source: "https://developers.cloudflare.com/workers-ai/models/qwen3.8-27b/" },
  { id: "@cf/openai/gpt-oss-120b", name: "GPT-OSS 120B", description: "Open-weight reasoning alternative", source: "https://developers.cloudflare.com/workers-ai/models/gpt-oss-120b/" },
] as const;
export type LearningModelId = (typeof LEARNING_MODELS)[number]["id"];
export const DEFAULT_LEARNING_MODEL: LearningModelId = "@cf/zai-org/glm-5.3";
export const SHORTCUT_LEARNING_MODEL: LearningModelId = "@cf/deepseek-ai/deepseek-v4.1-flash-1017";

export function learningModel(id: unknown): (typeof LEARNING_MODELS)[number] {
  const entry = LEARNING_MODELS.find((model) => model.id === id);
  if (!entry) throw new Error("Unknown learning model");
  return entry;
}

/** Resolve the persisted model into Pi's provider-scoped identity; never use arbitrary model IDs. */
export function learningModelReference(id: unknown): { provider: string; modelId: string } {
  const model = learningModel(id);
  return { provider: "cloudflare", modelId: model.id };
}

// GLM-5.3 needs a bounded reasoning mode; keep other models' existing behavior.
export function learningThinkingLevel(id: unknown): "low" | "off" {
  return learningModel(id).id === DEFAULT_LEARNING_MODEL ? "low" : "off";
}

/** The installed Pi AI catalog knows Kimi K3, but its Cloudflare string catalog predates K3.
 * Register the native Moonshot model with the same authenticated AI Gateway transport as Workers AI.
 */
export function createLearningModels(aiBinding: Ai, gatewayId: string) {
  const ai = createAI({ binding: aiBinding, id: gatewayId, skipCache: true });
  const models = createModels();
  // The installed Agents SDK's universal transport predates Moonshot. Its binding's
  // chat-completions transport still supports catalog IDs, so register Kimi there.
  // Keep metadata explicit instead of pretending the retired @cf/ K2 is still served.
  const kimi = {
    ...ai("@cf/google/gemma-4-26b-a4b-it"),
    id: "moonshotai/kimi-k3",
    name: "Kimi K3",
    contextWindow: 1_048_576,
    maxTokens: 131_072,
    cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 0 },
  };
  const additional = LEARNING_MODELS.filter((entry) => entry.id !== kimi.id).map((entry) => ai(entry.id));
  models.setProvider({
    ...ai.provider,
    getModels: () => [...ai.provider.getModels(), kimi, ...additional],
    getAllModels: () => [...(ai.provider.getAllModels?.() ?? ai.provider.getModels()), kimi, ...additional],
  });
  return models;
}
