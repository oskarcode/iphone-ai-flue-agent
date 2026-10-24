// A separate Computer survives session deletion. No application secrets are passed to its execution backend.
import { DurableObject } from "cloudflare:workers";
import { getWorkspace, withWorkspace } from "@cloudflare/computer";
import { WorkerShellBackend } from "@cloudflare/computer/backends/worker-shell";
import { WorkerJavaScriptBackend } from "@cloudflare/computer/backends/worker-javascript";
import curl from "@cloudflare/computer/shell/curl";
import files from "@cloudflare/computer/shell/file";
import html from "@cloudflare/computer/shell/html-to-markdown";
import jq from "@cloudflare/computer/shell/jq";
import { PERSONAL_OWNER, sha256 } from "./contracts.ts";
import {
  computerAction,
  computerPath,
  ComputerInputError,
  DEFAULT_SKILLS,
  skillFile,
  skillSlug,
  type Skill,
  type SkillSummary,
} from "../lib/skills.ts";
class ComputerHost extends DurableObject<CloudflareBindings> {
  storage() {
    return this.ctx.storage;
  }
  loader() {
    return this.env.SKILL_LOADER;
  }
  identity() {
    return this.ctx.id.toString();
  }
  context() {
    return this.ctx;
  }
}
const Base = withWorkspace(ComputerHost, (self) => ({
  storage: self.storage(),
  output: { maxBytes: 32000, maxLines: 500, keep: 10 },
  backends: [
    new WorkerShellBackend({
      id: "shell",
      egress: { mode: "direct" },
      loader: self.loader(),
      workspace: { binding: "LEARNING_SKILLS", id: self.identity() },
      ctx: self.context(),
      commands: [curl, files, html, jq],
    }),
    new WorkerJavaScriptBackend({
      id: "javascript",
      loader: self.loader(),
      root: "/workspace",
      access: "read-write",
      egress: { mode: "direct" },
      defaultTimeoutMs: 30000,
      maxTimeoutMs: 30000,
      maxResultBytes: 32000,
      maxStdioBytes: 32000,
    }),
  ],
}));
/** Input: verified owner and bounded operations. Output: persistent files, skills and execution receipts.
 * What this class does: serializes application edits, checks revisions and deduplicates approved mutations.
 */
export class LearningSkills extends Base {
  private tail: Promise<unknown> = Promise.resolve();
  private initialized = false;
  constructor(ctx: DurableObjectState, env: CloudflareBindings) {
    super(ctx, env);
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS skill_operations (id TEXT PRIMARY KEY, hash TEXT NOT NULL, status TEXT NOT NULL, result TEXT)",
    );
    ctx.storage.sql.exec(
      "UPDATE skill_operations SET status='uncertain' WHERE status='running'",
    );
  }
  private authorize(owner: string) {
    if (owner !== PERSONAL_OWNER) throw new Error("Session not found");
  }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.tail.then(work);
    this.tail = next.catch(() => {});
    return next;
  }
  private async workspace() {
    const ws = await getWorkspace(this);
    await ws.fs.mkdir("/workspace/skills", { recursive: true });
    if (!this.initialized) {
      if (!(await this.ctx.storage.get("skills:seeded:v1"))) {
        for (const skill of DEFAULT_SKILLS) {
          const dir = `/workspace/skills/${skill.slug}`;
          await ws.fs.mkdir(dir, { recursive: true });
          try {
            await ws.fs.stat(`${dir}/SKILL.md`);
          } catch {
            await ws.fs.writeFile(`${dir}/SKILL.md`, skillFile(skill));
          }
        }
        await this.ctx.storage.put("skills:seeded:v1", true);
      }
      this.initialized = true;
    }
    return ws;
  }
  private async readSkill(slug: string): Promise<Skill | null> {
    using ws = await this.workspace();
    const path = `/workspace/skills/${skillSlug(slug)}/SKILL.md`;
    try {
      await ws.fs.stat(path);
    } catch {
      return null;
    }
    const raw = await ws.fs.readFile(path, "utf8");
    if (new TextEncoder().encode(raw).length > 35000)
      throw new ComputerInputError("Skill file exceeds size limit.");
    const match = /^---\n([^\n]+)\n---\n+([\s\S]*)$/.exec(raw);
    if (!match)
      throw new ComputerInputError(
        "Skill needs JSON-compatible YAML frontmatter. Use the skill editor to repair it.",
      );
    const meta = JSON.parse(match[1]);
    const skill = {
      slug,
      name: meta.name,
      description: meta.description,
      markdown: match[2].trimEnd(),
      revision: await sha256(raw),
    };
    computerAction("skill.save", {
      ...skill,
      expectedRevision: skill.revision,
    });
    return skill;
  }
  async list(owner: string): Promise<SkillSummary[]> {
    this.authorize(owner);
    return this.serial(async () => {
      using ws = await this.workspace();
      const entries = await ws.fs.readdir("/workspace/skills");
      const result: SkillSummary[] = [];
      for (const entry of entries.slice(0, 100)) {
        if (!entry.isDirectory) continue;
        try {
          const skill = await this.readSkill(entry.name);
          if (skill) {
            const { markdown: _, ...summary } = skill;
            result.push(summary);
          }
        } catch {
          /* Malformed files stay visible in Computer; do not hide the rest of the catalog. */
        }
      }
      return result.sort((a, b) => a.name.localeCompare(b.name));
    });
  }
  async get(owner: string, slug: string) {
    this.authorize(owner);
    return this.serial(() => this.readSkill(slug));
  }
  async tree(owner: string) {
    this.authorize(owner);
    return this.serial(async () => {
      using ws = await this.workspace();
      return (await ws.fs.find("/workspace"))
        .slice(0, 300)
        .map(({ path, type }) => ({ path, type }));
    });
  }
  async read(owner: string, path: string) {
    this.authorize(owner);
    computerPath(path);
    return this.serial(async () => {
      using ws = await this.workspace();
      const stat = await ws.fs.stat(path);
      if (stat.size > 128000)
        throw new ComputerInputError("File is too large to preview.");
      return { path, content: await ws.fs.readFile(path, "utf8") };
    });
  }
  async apply(
    owner: string,
    operationId: string,
    tool: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    this.authorize(owner);
    computerAction(tool, args);
    if (!/^[\w:-]{8,200}$/.test(operationId))
      throw new ComputerInputError("Invalid operation ID.");
    return this.serial(async () => {
      const hash = await sha256(JSON.stringify({ tool, args }));
      const old = this.ctx.storage.sql
        .exec<{
          hash: string;
          status: string;
          result: string | null;
        }>("SELECT * FROM skill_operations WHERE id=?", operationId)
        .toArray()[0];
      if (old) {
        if (old.hash !== hash)
          throw new ComputerInputError(
            "Operation ID already used for different content.",
          );
        if (old.status !== "done")
          throw new ComputerInputError(
            "Previous operation was not confirmed. Inspect Computer before proposing another action.",
          );
        return JSON.parse(old.result!);
      }
      using ws = await this.workspace();
      if (tool.startsWith("skill.")) {
        const existing = await this.readSkill(String(args.slug));
        if ((existing?.revision ?? "") !== args.expectedRevision)
          throw new ComputerInputError(
            "Skill changed. Reload it before editing.",
          );
        if (
          !existing &&
          tool === "skill.save" &&
          (await ws.fs.readdir("/workspace/skills")).length >= 100
        )
          throw new ComputerInputError("Skill limit reached.");
      }
      this.ctx.storage.sql.exec(
        "INSERT INTO skill_operations VALUES(?,?,'running',NULL)",
        operationId,
        hash,
      );
      try {
        let result: unknown;
        if (tool === "skill.save") {
          const dir = `/workspace/skills/${skillSlug(args.slug)}`;
          await ws.fs.mkdir(dir, { recursive: true });
          await ws.fs.writeFile(
            `${dir}/SKILL.md`,
            skillFile(args as Pick<Skill, "name" | "description" | "markdown">),
          );
          result = await this.readSkill(String(args.slug));
        } else if (tool === "skill.delete") {
          await ws.fs.rm(`/workspace/skills/${skillSlug(args.slug)}`, {
            recursive: true,
            force: true,
          });
          result = { deleted: args.slug };
        } else if (tool === "computer.write") {
          const path = computerPath(args.path);
          await ws.fs.mkdir(path.slice(0, path.lastIndexOf("/")), {
            recursive: true,
          });
          await ws.fs.writeFile(path, String(args.content));
          result = { path };
        } else if (tool === "computer.delete") {
          await ws.fs.rm(computerPath(args.path), {
            recursive: true,
            force: true,
          });
          result = { deleted: args.path };
        } else {
          using execution = await ws.runtime.exec(String(args.command), {
            backend: args.backend === "javascript" ? "javascript" : "shell",
            cwd: "/workspace",
            encoding: "utf8",
            timeoutMs: 30000,
          });
          const output = await execution.result();
          result = {
            exitCode: output.exitCode,
            status: output.status,
            stdout: output.stdout.slice(0, 32000),
            stderr: output.stderr.slice(0, 8000),
            ...(output.value !== undefined ? { value: output.value } : {}),
          };
        }
        this.ctx.storage.sql.exec(
          "UPDATE skill_operations SET status='done',result=? WHERE id=?",
          JSON.stringify(result),
          operationId,
        );
        return result;
      } catch (error) {
        this.ctx.storage.sql.exec(
          "UPDATE skill_operations SET status='uncertain' WHERE id=?",
          operationId,
        );
        throw error;
      }
    });
  }
}
