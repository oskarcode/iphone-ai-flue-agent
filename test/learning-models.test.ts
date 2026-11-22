import { describe, expect, it } from "vitest";
import { createLearningModels, DEFAULT_LEARNING_MODEL, LEARNING_MODELS, learningModel, learningModelReference, learningThinkingLevel } from "../src/lib/learning-models.ts";

describe("learning model registry", () => {
  it("offers six explicit, unique models and rejects retired or arbitrary IDs", () => {
    expect(LEARNING_MODELS).toHaveLength(6);
    expect(new Set(LEARNING_MODELS.map((model) => model.id)).size).toBe(6);
    expect(DEFAULT_LEARNING_MODEL).toBe("@cf/zai-org/glm-5.3");
    expect(LEARNING_MODELS[1].id).toBe("moonshotai/kimi-k3");
    expect(learningModelReference(DEFAULT_LEARNING_MODEL)).toEqual({ provider: "cloudflare", modelId: "@cf/zai-org/glm-5.3" });
    expect(learningThinkingLevel(DEFAULT_LEARNING_MODEL)).toBe("low");
    expect(learningThinkingLevel(LEARNING_MODELS[1].id)).toBe("off");
    for (const id of ["@cf/zai-org/glm-5.3-flash", "@cf/moonshotai/kimi-k2.7-code", "openai/gpt-5.5", "../../unknown"])
      expect(() => learningModel(id)).toThrow("Unknown learning model");
  });
  it("registers Kimi via the existing AI Gateway transport alongside Workers AI alternatives", () => {
    const models = createLearningModels({} as Ai, "iphone-flue-shortcut");
    expect(models.getModel("cloudflare", "moonshotai/kimi-k3")).toMatchObject({ id: "moonshotai/kimi-k3", provider: "cloudflare", api: "cloudflare-ai" });
    for (const entry of LEARNING_MODELS.filter((entry) => entry.id !== "moonshotai/kimi-k3"))
      expect(models.getModel("cloudflare", entry.id)).toMatchObject({ id: entry.id, provider: "cloudflare" });
  });
});
