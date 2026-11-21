import { describe, expect, it } from "vitest";
import { createLearningModels, DEFAULT_LEARNING_MODEL, LEARNING_MODELS, learningModel, learningModelReference } from "../src/lib/learning-models.ts";

describe("learning model registry", () => {
  it("offers five explicit, unique models and rejects retired or arbitrary IDs", () => {
    expect(LEARNING_MODELS).toHaveLength(5);
    expect(new Set(LEARNING_MODELS.map((model) => model.id)).size).toBe(5);
    expect(DEFAULT_LEARNING_MODEL).toBe("moonshotai/kimi-k3");
    expect(learningModelReference(DEFAULT_LEARNING_MODEL)).toEqual({ provider: "cloudflare", modelId: "moonshotai/kimi-k3" });
    expect(learningModelReference(LEARNING_MODELS[1].id)).toEqual({ provider: "cloudflare", modelId: "@cf/deepseek-ai/deepseek-v4.1-flash-1017" });
    for (const id of ["@cf/zai-org/glm-5.3-flash", "@cf/moonshotai/kimi-k2.7-code", "openai/gpt-5.5", "../../unknown"])
      expect(() => learningModel(id)).toThrow("Unknown learning model");
  });
  it("registers Kimi via the existing AI Gateway transport alongside Workers AI alternatives", () => {
    const models = createLearningModels({} as Ai, "iphone-flue-shortcut");
    expect(models.getModel("cloudflare", "moonshotai/kimi-k3")).toMatchObject({ id: "moonshotai/kimi-k3", provider: "cloudflare", api: "cloudflare-ai" });
    for (const entry of LEARNING_MODELS.slice(1))
      expect(models.getModel("cloudflare", entry.id)).toMatchObject({ id: entry.id, provider: "cloudflare" });
  });
});
