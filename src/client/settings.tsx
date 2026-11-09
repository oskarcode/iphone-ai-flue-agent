import React, { useEffect, useState, useRef } from "react";
import { api } from "./api.ts";
import { GadgetLibrary } from "./gadgets.tsx";
import { ScheduleDirectory } from "./schedules.tsx";
import type { Skill, SkillSummary } from "../lib/skills.ts";
const blank = (): Skill => ({
  slug: "",
  name: "",
  description: "",
  markdown: "",
  revision: "",
});
type Props = {
  preferences(): void;
  clearDrafts(): void;
  signOut(): void;
  createWithAgent(): void;
  skillsChanged(): void;
  gadgetsChanged(): void;
};
/** Input: settings actions. Output: one mobile settings surface for preferences, skills, Computer and account.
 * What this function does: keeps administration away from chat and uses revision-checked, explicit mutations.
 */
export function Settings(props: Props) {
  const [tab, setTab] = useState<"learning" | "gadgets" | "schedules" | "skills" | "computer" | "account">("learning");
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [selected, setSelected] = useState<Skill>();
  const [files, setFiles] = useState<{ path: string; type: string }[]>([]);
  const [file, setFile] = useState<{ path: string; content: string }>();
  const [command, setCommand] = useState("");
  const [backend, setBackend] = useState("shell");
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef<{ key: string; body: string } | undefined>(undefined);
  async function reload() {
    const [catalog, tree] = await Promise.all([
      api<{ skills: SkillSummary[] }>("/api/skills"),
      api<{ entries: { path: string; type: string }[] }>("/api/computer"),
    ]);
    setSkills(catalog.skills);
    setFiles(tree.entries);
    props.skillsChanged();
  }
  useEffect(() => {
    void reload().catch((e) => setError(String(e)));
  }, []);
  async function action(tool: string, args: Record<string, unknown>) {
    const body = JSON.stringify({ tool, args });
    if (pending.current?.body !== body)
      pending.current = { body, key: crypto.randomUUID() };
    const value = await api<unknown>("/api/computer/actions", {
      method: "POST",
      headers: { "Idempotency-Key": pending.current.key },
      body,
    });
    pending.current = undefined;
    await reload();
    return value;
  }
  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="settings-content">
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {result && <pre className="computer-output" role="status">{result}</pre>}
      <nav className="settings-tabs" aria-label="Settings sections">
        {(["learning", "gadgets", "schedules", "skills", "computer", "account"] as const).map((name) => (
          <button key={name} type="button" aria-current={tab === name ? "page" : undefined} onClick={() => setTab(name)}>
            {name === "computer" ? "Computer" : name[0].toUpperCase() + name.slice(1)}
          </button>
        ))}
      </nav>
      {tab === "learning" && <section className="settings-card">
        <h2>Learning</h2>
        <button onClick={props.preferences}>Learning preferences</button>
      </section>}
      {tab === "gadgets" && <GadgetLibrary changed={props.gadgetsChanged} />}
      {tab === "schedules" && <ScheduleDirectory />}
      {tab === "skills" && <section className="settings-card">
        <h2>Skills</h2>
        <p>
          Reusable instructions stored on your Cloudflare Computer. Available in
          every session, even after a conversation is deleted.
        </p>
        <button disabled={busy} onClick={() => setSelected(blank())}>
          New skill
        </button>
        <button onClick={props.createWithAgent}>
          Create a skill with the assistant
        </button>
        <button disabled={busy} onClick={() => void run(reload)}>
          Refresh skills and files
        </button>
        <div className="skill-list">
          {skills.map((skill) => (
            <button
              key={skill.slug}
              disabled={busy}
              onClick={() =>
                void run(async () =>
                  setSelected(await api<Skill>(`/api/skills/${skill.slug}`)),
                )
              }
            >
              <strong>/{skill.slug}</strong>
              <span>{skill.name}</span>
            </button>
          ))}
        </div>
        {selected && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                const saved = (await action("skill.save", {
                  slug: selected.slug,
                  name: selected.name,
                  description: selected.description,
                  markdown: selected.markdown,
                  expectedRevision: selected.revision,
                })) as Skill;
                setSelected(saved);
                setResult(
                  `Saved /${saved.slug}. The command is available in chat.`,
                );
              });
            }}
          >
            <label>
              Command
              <input
                aria-label="Skill command"
                value={selected.slug}
                disabled={busy || !!selected.revision}
                onChange={(e) =>
                  setSelected({ ...selected, slug: e.target.value })
                }
                placeholder="explain-with-analogies"
                required
                maxLength={60}
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
              />
            </label>
            <label>
              Name
              <input
                aria-label="Skill name"
                value={selected.name}
                disabled={busy}
                onChange={(e) =>
                  setSelected({ ...selected, name: e.target.value })
                }
                required
                maxLength={100}
              />
            </label>
            <label>
              Description
              <input
                aria-label="Skill description"
                value={selected.description}
                disabled={busy}
                onChange={(e) =>
                  setSelected({ ...selected, description: e.target.value })
                }
                required
                maxLength={500}
              />
            </label>
            <label>
              Instructions
              <textarea
                aria-label="Skill instructions"
                value={selected.markdown}
                disabled={busy}
                onChange={(e) =>
                  setSelected({ ...selected, markdown: e.target.value })
                }
                required
                maxLength={32000}
              />
            </label>
            <button disabled={busy}>Save skill</button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setSelected(undefined)}
            >
              Close skill editor
            </button>
            {selected.revision && (
              <button
                className="danger"
                type="button"
                disabled={busy}
                onClick={() => void run(async () => {
                  await action("skill.delete", {
                    slug: selected.slug,
                    expectedRevision: selected.revision,
                  });
                  setSelected(undefined);
                  setResult("Skill removed.");
                })}
              >
                Delete skill
              </button>
            )}
          </form>
        )}
      </section>}
      {tab === "computer" && <section className="settings-card">
        <h2>Cloudflare Computer</h2>
        <p>
          Persistent files, a worker-shell with curl/jq/file commands, and an
          isolated JavaScript backend. This preview SDK is not a full Linux VM.
          Commands can change or remove workspace files and make network
          requests.
        </p>
        <details>
          <summary>Browse files ({files.length}, up to 300)</summary>
          <div className="computer-files">
            {files
              .filter((entry) => entry.type === "file")
              .map((entry) => (
                <button
                  key={entry.path}
                  disabled={busy}
                  onClick={() =>
                    void run(async () =>
                      setFile(
                        await api(
                          `/api/computer/file?path=${encodeURIComponent(entry.path)}`,
                        ),
                      ),
                    )
                  }
                >
                  {entry.path}
                </button>
              ))}
          </div>
        </details>
        {file && (
          <div>
            <h3>{file.path}</h3>
            <pre className="computer-output">{file.content}</pre>
            <button onClick={() => setFile(undefined)}>
              Close file preview
            </button>
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (
              confirm(
                "Run this exact command on your persistent Computer? It may change files or access the network.\n\n" +
                  command,
              )
            )
              void run(async () =>
                setResult(
                  JSON.stringify(
                    await action("computer.run", { command, backend }),
                    null,
                    2,
                  ),
                ),
              );
          }}
        >
          <label>
            Execution backend
            <select
              aria-label="Execution backend"
              value={backend}
              disabled={busy}
              onChange={(e) => setBackend(e.target.value)}
            >
              <option value="shell">Shell</option>
              <option value="javascript">JavaScript module</option>
            </select>
          </label>
          <label>
            Command or JavaScript module
            <textarea
              aria-label="Computer command"
              value={command}
              disabled={busy}
              onChange={(e) => setCommand(e.target.value)}
              placeholder={
                backend === "shell"
                  ? "ls /workspace/skills"
                  : "export default async function () { return 2 + 3; }"
              }
              maxLength={8000}
              required
            />
          </label>
          <button disabled={busy || !command.trim()}>Run command</button>
        </form>
      </section>}
      {tab === "account" && <section className="settings-card">
        <h2>Device & account</h2>
        <p>
          Clearing drafts affects this browser only, not saved conversations or
          skills.
        </p>
        <button onClick={props.clearDrafts}>Clear device drafts</button>
        <button onClick={props.signOut}>Sign out</button>
      </section>}
    </div>
  );
}
