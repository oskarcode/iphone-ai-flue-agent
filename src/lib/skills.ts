// Shared skill contracts and bounded validation; no Cloudflare runtime dependencies in the browser.
import {
  LEARNING_RECAP_PROMPT,
  REPOSITORY_STARTER_PROMPTS,
} from "./chat-presets.ts";
export type Skill = {
  slug: string;
  name: string;
  description: string;
  markdown: string;
  revision: string;
};
export type SkillSummary = Omit<Skill, "markdown">;
export class ComputerInputError extends Error {}
export function skillSlug(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) ||
    value.length > 60
  )
    throw new ComputerInputError(
      "Use a skill command with lowercase letters, numbers and hyphens.",
    );
  return value;
}
export function computerText(
  value: unknown,
  max: number,
  label = "Text",
): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    new TextEncoder().encode(value).length > max
  )
    throw new ComputerInputError(`${label} is empty or too large.`);
  return value;
}
export function computerPath(value: unknown): string {
  const path = computerText(value, 500, "Path");
  if (
    !path.startsWith("/workspace/") ||
    path.includes("\\") ||
    path.includes("\0") ||
    path
      .split("/")
      .slice(2)
      .some((part) => !part || part === "." || part === "..")
  )
    throw new ComputerInputError(
      "Choose a file beneath /workspace without traversal.",
    );
  return path;
}
export const COMPUTER_ACTIONS = [
  "skill.save",
  "skill.delete",
  "computer.write",
  "computer.delete",
  "computer.run",
] as const;
export function computerAction(tool: string, args: Record<string, unknown>) {
  if (!(COMPUTER_ACTIONS as readonly string[]).includes(tool))
    throw new ComputerInputError("Unknown Computer action.");
  if (tool.startsWith("skill.")) {
    skillSlug(args.slug);
    if (
      typeof args.expectedRevision !== "string" ||
      args.expectedRevision.length > 64
    )
      throw new ComputerInputError(
        "Read the current skill revision before changing it.",
      );
    if (tool === "skill.save") {
      computerText(args.name, 100, "Name");
      computerText(args.description, 500, "Description");
      computerText(args.markdown, 32000, "Instructions");
    }
  } else if (tool === "computer.run") {
    computerText(args.command, 8000, "Command");
    if (
      args.backend !== undefined &&
      args.backend !== "shell" &&
      args.backend !== "javascript"
    )
      throw new ComputerInputError("Unknown execution backend.");
  } else {
    computerPath(args.path);
    if (tool === "computer.write")
      computerText(args.content, 128000, "File content");
  }
  return args;
}
export const DEFAULT_SKILLS = [
  {
    slug: "explain-simply",
    name: "Explain simply",
    description:
      "Explain the current topic in plain language with a small example.",
    markdown:
      "Explain the main idea in plain English with a small example. Use the user’s question and current conversation; ask for a topic if none is available.",
  },
  ...REPOSITORY_STARTER_PROMPTS.map(([name, markdown], i) => ({
    slug: [
      "high-level-purpose",
      "architecture-map",
      "traffic-flow",
      "api-backend-frontend",
      "folder-tour",
      "code-walkthrough",
      "safe-change-plan",
    ][i],
    name,
    description: markdown,
    markdown,
  })),
  {
    slug: "learning-post",
    name: "What I learned · post draft",
    description:
      "Draft a grounded social post from this conversation, never publish it.",
    markdown: LEARNING_RECAP_PROMPT,
  },
];
export function skillFile(
  skill: Pick<Skill, "name" | "description" | "markdown">,
): string {
  return `---\n${JSON.stringify({ name: skill.name, description: skill.description })}\n---\n\n${skill.markdown}\n`;
}
