/** A fixed, reviewed syllabus. Excerpts are short teaching adaptations of the named files,
 * not claims that live source is unchanged. Week four deliberately awaits the learner's goal. */
const lessons = [
  // Week 1: language fundamentals, deliberately not a Python bridge.
  {
    title: "Values, variables and types",
    focus:
      "JavaScript runs values; TypeScript checks source before it runs. Inferred types can forbid assignments without changing runtime JavaScript.",
    source: "Illustrative foundation",
    code: "let count = 1;\ncount += 1;\nconst label: string = 'turns';",
    explain:
      "let permits reassignment; const prevents rebinding. A type annotation describes acceptable values and is erased at runtime.",
    qs: [
      [
        "After count += 1, what is count?",
        ["1", "2", "A TypeScript type"],
        1,
        "The addition changes the number value from 1 to 2; the type is not a runtime value.",
      ],
      [
        "Which assignment is rejected by the type checker?",
        ["count = 3", "const other = label", "count = 'two'"],
        2,
        "count was inferred as number, so a string is rejected. Reading label into a new const is allowed; rebinding label would not be.",
      ],
    ],
  },
  {
    title: "Arrays and tuples",
    focus:
      "Use an array for an arbitrary number of similar entries; a tuple records fixed positions with distinct meanings.",
    source: "Illustrative messages",
    code: "const roles: string[] = ['user', 'assistant'];\nconst pair: [string, number] = ['turn', 2];\nconst labels = roles.map(role => role.toUpperCase());",
    explain:
      "map returns a new array; it does not change roles. The tuple fixes the first item as string and second as number.",
    qs: [
      [
        "What is labels[1]?",
        ["'assistant'", "'ASSISTANT'", "2"],
        1,
        "map calls toUpperCase for each element and produces a new array.",
      ],
      [
        "Which is a valid pair?",
        ["[2, 'turn']", "['turn', 2]", "['turn']"],
        1,
        "The tuple requires exactly a string first and number second.",
      ],
    ],
  },
  {
    title: "Objects and property access",
    focus:
      "Objects group named values. Optional fields require an absence check; readonly fields cannot be reassigned through that type.",
    source: "src/runtime/contracts.ts · Message",
    code: "type Message = { role: 'user' | 'assistant'; content: string; createdAt?: string };\nconst m: Message = { role: 'user', content: 'Hi' };\nconst date = m.createdAt?.slice(0, 10);",
    explain:
      "The ? in createdAt?: means it may be absent. ?. prevents calling slice on undefined; date may also be undefined.",
    qs: [
      [
        "What is date for this m?",
        ["An empty string", "undefined", "A timestamp"],
        1,
        "createdAt is absent, so optional chaining stops and returns undefined.",
      ],
      [
        "Which property must every Message have?",
        ["createdAt", "content", "id"],
        1,
        "content is required; createdAt is optional and id is not in this example type.",
      ],
    ],
  },
  {
    title: "Functions, callbacks and closures",
    focus:
      "A function specifies inputs and output. A callback is a function passed to another function; it can capture values from its surrounding scope.",
    source: "Adapted from src/runtime/session.ts · entryMessage",
    code: "const wanted = 'assistant';\nconst matching = messages.filter(m => m.role === wanted);\nfunction count(items: Message[]): number { return items.length; }",
    explain:
      "filter calls the arrow function for each item and returns a new array. Its callback captures wanted; count explicitly returns a number.",
    qs: [
      [
        "Does filter change messages?",
        ["Yes", "No; it returns a new array", "Only if wanted changes"],
        1,
        "filter creates a new array; matching contains only entries whose role matches wanted.",
      ],
      [
        "What does the callback return?",
        ["A Message", "A boolean", "A number"],
        1,
        "The === expression is true or false; filter keeps items for which it is true.",
      ],
    ],
  },
  {
    title: "Unions, narrowing and unknown",
    focus:
      "A union admits several shapes. Check a discriminator or typeof before using shape-specific data. unknown requires evidence; any suppresses checks.",
    source: "Adapted from src/runtime/contracts.ts · Approval",
    code: "type Result = { status: 'done'; value: string } | { status: 'error'; reason: string };\nfunction show(r: Result) { return r.status === 'done' ? r.value : r.reason; }",
    explain:
      "status narrows the union: value exists only in the done branch and reason only in the error branch.",
    qs: [
      [
        "Can show read r.value before checking status?",
        ["Yes", "No", "Only at runtime"],
        1,
        "The error variant has no value property, so the type checker requires narrowing first.",
      ],
      [
        "Which should describe unvalidated JSON?",
        ["any", "unknown", "never"],
        1,
        "unknown forces a check before property access; any would bypass that safety.",
      ],
    ],
  },
  {
    title: "Classes, methods and composition",
    focus:
      "A class combines constructor-initialized dependencies with methods. extends inherits behavior; composition passes a dependency rather than inheriting it.",
    source: "Illustrative Counter; compare with src/runtime/session.ts · LearningSession",
    code: "class Counter {\n  constructor(private start: number) {}\n  next(): number { this.start += 1; return this.start; }\n}\nconst c = new Counter(0);",
    explain:
      "The constructor sets an instance field. this.start refers to that particular Counter; each instance has its own field.",
    qs: [
      [
        "What does c.next() return first?",
        ["0", "1", "undefined"],
        1,
        "The method increments its own start field before returning it.",
      ],
      [
        "Why does a method use this.start?",
        [
          "To reach this instance's field",
          "To import a module",
          "To change every Counter",
        ],
        0,
        "this refers to the specific instance; another Counter has separate state.",
      ],
    ],
  },
  {
    title: "Week 1 review: asynchronous modules",
    focus:
      "An async function returns a Promise. await waits for its result; imports and exports connect separately typed modules. Review values, objects and functions together.",
    source: "Illustrative foundation",
    code: "export async function readMessage(): Promise<Message> {\n  const response = await fetch('/message');\n  return response.json() as Promise<Message>;\n}",
    explain:
      "The return is a Promise, not an immediately available Message. A cast asserts a type; it does not validate a server response.",
    qs: [
      [
        "What does calling readMessage() immediately return?",
        ["A Message object", "Promise<Message>", "A boolean"],
        1,
        "async functions return promises; a caller must await or chain the result.",
      ],
      [
        "Does as Promise<Message> verify the JSON shape?",
        ["Yes", "No", "Only in development"],
        1,
        "A TypeScript assertion provides no runtime validation; Week 2 uses schemas at this boundary.",
      ],
    ],
  },
  // Week 2: read and enhance the real Pi Durable harness.
  {
    title: "The harness host contract",
    focus:
      "An interface specifies capabilities without exposing implementation. RuntimeHost lets tools request session work without owning SQL or HTTP.",
    source: "src/runtime/harness.ts · RuntimeHost",
    code: "interface RuntimeHost {\n  metadata(): SessionMetadata;\n  update(patch: Partial<SessionMetadata>): Promise<void>;\n}",
    explain:
      "metadata returns a value synchronously; update is async. Partial makes each metadata property optional in the patch, not optional in the stored record.",
    qs: [
      [
        "What does host.update({ title: 'New' }) return?",
        ["SessionMetadata", "Promise<void>", "string"],
        1,
        "The signature promises completion but no result value.",
      ],
      [
        "Does Partial make the stored owner optional?",
        ["Yes", "No; only fields in the patch", "It removes owner"],
        1,
        "Partial applies to the patch argument, not to the underlying SessionMetadata type.",
      ],
    ],
  },
  {
    title: "Tool arguments and validation",
    focus:
      "A model proposes JSON arguments. A schema describes permitted input; a runtime parser checks actual arguments before a tool executes.",
    source: "src/runtime/harness.ts · adapt",
    code: "const data = v.parse(tool.input, args);\nconst result = await tool.run({ data, signal: context.abortSignal });\nreturn { output: [{ type: 'text', text: JSON.stringify(result.output) }] };",
    explain:
      "v.parse is the runtime boundary, unlike a TypeScript annotation. The validated data is passed to the tool, then its output is serialized.",
    qs: [
      [
        "What stops malformed arguments before tool.run?",
        ["The model's description", "v.parse", "JSON.stringify"],
        1,
        "Runtime validation happens in v.parse; descriptions and types alone cannot validate model output.",
      ],
      [
        "Why await tool.run?",
        [
          "It returns a Promise",
          "It changes the type into JSON",
          "It skips validation",
        ],
        0,
        "await obtains the asynchronous tool result before serializing its output.",
      ],
    ],
  },
  {
    title: "Registering a tool",
    focus:
      "A registered tool connects a name and argument schema to an execute function; this is a typed interface between model intent and application behavior.",
    source: "src/runtime/harness.ts · defineTool",
    code: "defineTool({\n  name: 'read_skill',\n  parameters: Type.Object({ slug: Type.String({ maxLength: 60 }) }),\n  replay: 'safe',\n  execute: async ({ slug }) => output(await computer().get(owner, slug)),\n});",
    explain:
      "Destructuring obtains slug from validated arguments. replay: safe is suitable for this read; mutation tools need stronger replay handling.",
    qs: [
      [
        "Which input is accepted by the declared shape?",
        ["{ slug: 'daily' }", "{ title: 'daily' }", "'daily'"],
        0,
        "The schema describes an object with a slug string field.",
      ],
      [
        "Is reading a skill the same as saving it?",
        ["Yes", "No; this execute calls get", "Only on retries"],
        1,
        "The execute body calls get, not a save method; the body determines the actual effect.",
      ],
    ],
  },
  {
    title: "Classes in the persistent session",
    focus:
      "LearningSession extends DurableObject, but its in-memory fields may disappear on eviction; SQLite is the source of retained state.",
    source: "src/runtime/session.ts · LearningSession",
    code: "class LearningSession extends DurableObject<CloudflareBindings> {\n  private harness?: Harness;\n  private readonly gadgets: LearningGadgets;\n  constructor(ctx: DurableObjectState, env: CloudflareBindings) {\n    super(ctx, env);\n    this.gadgets = new LearningGadgets(ctx, env.SKILL_LOADER);\n  }\n}",
    explain:
      "super initializes the base class. harness? is an optional in-memory handle; persisted gadget data is stored separately, not in that field.",
    qs: [
      [
        "What should survive object eviction?",
        ["Only this.harness", "SQLite state", "A local variable"],
        1,
        "Process memory is disposable; durable storage retains the canonical data.",
      ],
      [
        "Why call super(ctx, env)?",
        [
          "To initialize the base class",
          "To write a chat message",
          "To invoke a tool",
        ],
        0,
        "A subclass constructor must initialize its DurableObject base before using this.",
      ],
    ],
  },
  {
    title: "Submitting a turn",
    focus:
      "Harness.open attaches the Pi conversation to storage; root.submit records a user input and schedules agent work rather than immediately returning an answer.",
    source: "src/runtime/session.ts · open and submit",
    code: "const harness = await Harness.open(storage, options, background);\nconst root = await harness.root(background);\nconst submission = await root.submit({ type: 'input', content: text, requestId }, background);",
    explain:
      "There are separate async operations: open the harness, find the root conversation, and submit input. The submission receipt is not the final assistant message.",
    qs: [
      [
        "Does submit's receipt mean an answer is finished?",
        ["Yes", "No", "Only if a tool was called"],
        1,
        "A submission is accepted work; generation and tool execution may continue afterward.",
      ],
      [
        "Which value owns the conversation?",
        ["root", "text", "background"],
        0,
        "The root conversation is obtained from the opened harness before input is submitted.",
      ],
    ],
  },
  {
    title: "Events and UI projection",
    focus:
      "Agent events include ongoing generation and tool work. A UI should project approved visible data, not show raw reasoning or every internal event.",
    source: "src/runtime/session.ts · watchEvents and entryMessage",
    code: "const stream = await watchEvents(harness, root.id, background);\nstream.start(async events => {\n  for (const event of events) activity.record([event]);\n});",
    explain:
      "watchEvents observes a particular root conversation. This excerpt is simplified: the real handler also synchronizes and notifies clients.",
    qs: [
      [
        "What does root.id select here?",
        [
          "The conversation being watched",
          "The current tool's name",
          "A browser tab",
        ],
        0,
        "The event stream is attached to the root conversation ID.",
      ],
      [
        "Should the UI render all raw internal events?",
        ["Yes", "No; project safe visible state", "Only tool arguments"],
        1,
        "The application sanitizes visible messages and operational progress rather than leaking reasoning or raw provider details.",
      ],
    ],
  },
  {
    title: "Week 2 review: typed tool flow",
    focus:
      "Connect interface, schema, validation, async execution and session ownership into one mental model. Explain which layer changes when a new read-only tool is added.",
    source: "src/runtime/harness.ts + src/runtime/session.ts",
    code: "model arguments → schema → v.parse → tool.run → tool result\nLearningSession supplies RuntimeHost capabilities to the harness.",
    explain:
      "This diagram is pseudocode, not executable TypeScript. Types describe contracts; v.parse validates runtime input; the session owns persisted state.",
    qs: [
      [
        "What actually verifies model-supplied input at runtime?",
        ["RuntimeHost", "v.parse", "An interface"],
        1,
        "Types and interfaces are erased; the parser checks the value the model supplied.",
      ],
      [
        "Where should canonical conversation state live?",
        [
          "Only in the browser",
          "In the session's durable storage",
          "In a tool description",
        ],
        1,
        "LearningSession persists canonical state; browser views and directories are projections.",
      ],
    ],
  },
  // Week 3: trace a complete real request, then its failure path.
  {
    title: "Request enters the Worker",
    focus:
      "Follow POST /api/sessions/:id/messages. Identify body validation, the owner boundary, and the session lookup before agent execution.",
    source: "src/app.ts · POST /api/sessions/:id/messages",
    code: "if (typeof body?.text !== 'string' || !body.text.trim())\n  return c.json({ error: 'Invalid message' }, 400);\nconst target = await ensure(c, c.req.param('id'));",
    explain:
      "Invalid text is rejected before ensure resolves the canonical session. The real route also checks length and requestId; Access protects the app before it reaches this route.",
    qs: [
      [
        "What happens for text = ''?",
        ["Call the model", "Return 400", "Create a gadget"],
        1,
        "The guard rejects empty text before session submission.",
      ],
      [
        "Does knowing the session ID authorize access?",
        ["Yes", "No; owner checks remain", "Only for GET"],
        1,
        "IDs locate sessions; authenticated owner checks protect their data.",
      ],
    ],
  },
  {
    title: "Request IDs and durable submission",
    focus:
      "The request has an ID so retries can be recognized. Distinguish accepting one input from running an entire model turn twice.",
    source: "src/app.ts + src/runtime/session.ts · submit",
    code: "const receipt = await target.submit(owner, body.text, body.requestId);\nreturn c.json(receipt, 202);",
    explain:
      "HTTP 202 means accepted, not answered. The session checks the request identity and persists the submission so a browser retry cannot simply duplicate a turn.",
    qs: [
      [
        "What does HTTP 202 assert?",
        ["A complete answer", "Accepted work", "An executed SQL query"],
        1,
        "The turn was accepted; follow its later events for completion.",
      ],
      [
        "Why provide requestId?",
        ["To identify retries", "To choose the model", "To bypass Access"],
        0,
        "Stable request identity lets the session recognize duplicate submissions.",
      ],
    ],
  },
  {
    title: "The session opens its harness",
    focus:
      "After lookup, the session opens or reuses its Pi Durable harness, attaching model settings and tools to canonical SQLite state.",
    source: "src/runtime/session.ts · open",
    code: "const options = createLearningHarnessOptions(this.env, host);\nconst harness = await Harness.open(storage, options, background);\nconst root = await harness.root(background);",
    explain:
      "Options wire app capabilities into Pi Durable. Harness.open connects the durable conversation to storage; root names the conversation receiving the turn.",
    qs: [
      [
        "Which function assembles tools and model options?",
        ["createLearningHarnessOptions", "root.submit", "watchEvents"],
        0,
        "The options factory builds the harness configuration from bindings and the session host.",
      ],
      [
        "Does a browser own the root conversation?",
        ["Yes", "No; the session does", "Only until refresh"],
        1,
        "The session owns persisted conversation state; browser views attach to it.",
      ],
    ],
  },
  {
    title: "The model chooses a tool",
    focus:
      "A model may issue a tool call. Its arguments are untrusted until parsed, and each tool runs through an application capability with bounded output.",
    source: "src/runtime/harness.ts · adapt",
    code: "const data = v.parse(tool.input, args);\nconst result = await tool.run({ data, signal: context.abortSignal });\nawait host.source(`tool:${api.taskId}`, tool.name, JSON.stringify(result.output));",
    explain:
      "Validation precedes execution. Retained evidence is keyed by the task ID; a tool result is not automatically an assistant answer.",
    qs: [
      [
        "If v.parse rejects args, is tool.run called?",
        ["Yes", "No", "Only after a retry"],
        1,
        "Parsing throws before execution, preventing malformed arguments from reaching the tool.",
      ],
      [
        "Why keep taskId with evidence?",
        [
          "To identify this tool run",
          "To replace the session ID",
          "To bypass validation",
        ],
        0,
        "The task ID ties retained evidence and replay handling to this particular operation.",
      ],
    ],
  },
  {
    title: "Events become a visible answer",
    focus:
      "Generation and tool events are not identical to finalized visible text. Trace a completed assistant entry through the UI projection.",
    source: "src/runtime/session.ts · watchEvents and entryMessage",
    code: "const message = entry.model?.find(m => m.role === 'assistant');\nconst text = message?.content;\n// Real code filters content blocks and excludes reasoning.",
    explain:
      "This is intentionally illustrative. The real entryMessage selects visible text blocks; internal reasoning and raw tool content should not become the chat transcript.",
    qs: [
      [
        "Is every tool event an assistant message?",
        ["Yes", "No", "Only an error"],
        1,
        "Events describe work; visible assistant text is projected from appropriate completed entries.",
      ],
      [
        "Which is safe to show as the answer?",
        ["Raw reasoning", "Filtered visible assistant text", "Provider errors"],
        1,
        "The projection should expose the completed user-facing text, not private internals.",
      ],
    ],
  },
  {
    title: "Failures and retries",
    focus:
      "A failed read can often be retried; an uncertain external write must be inspected before another attempt. Keep the accepted request distinct from tool side effects.",
    source: "src/runtime/session.ts · approval receipts",
    code: "if (approval.status === 'executing')\n  approval.status = 'uncertain';\n// Inspect external state before repeating a write.",
    explain:
      "An interrupted write may have succeeded externally. Marking it uncertain avoids blindly duplicating a GitHub or Computer mutation.",
    qs: [
      [
        "Should an uncertain external write be repeated immediately?",
        ["Yes", "No; inspect its outcome", "Only if the UI refreshes"],
        1,
        "The side effect may already have happened; check a durable receipt or the external state first.",
      ],
      [
        "Is a rejected input the same as an uncertain write?",
        ["Yes", "No", "Only with a tool"],
        1,
        "Input rejection happens before the operation; uncertainty arises after a write may have crossed a boundary.",
      ],
    ],
  },
  {
    title: "Week 3 review: trace one request",
    focus:
      "Reconstruct route → owner-checked session → submission → harness → optional tool → events → visible answer. Then locate the boundary where a failed tool changes the trace.",
    source: "src/app.ts + src/runtime/session.ts + src/runtime/harness.ts",
    code: "POST /messages → ensure(owner) → submit(requestId) → root\n→ validated tool (optional) → events → projected answer",
    explain:
      "This is a learning flow diagram, not executable code. Each arrow crosses a distinct boundary; a receipt is not the final answer.",
    qs: [
      [
        "Which step prevents cross-owner session access?",
        ["The ID alone", "ensure and owner authorization", "The model prompt"],
        1,
        "Route and session authorization enforce ownership independently of model instructions.",
      ],
      [
        "Where does malformed model tool input fail?",
        [
          "Before v.parse",
          "At runtime validation before tool.run",
          "Only in the browser",
        ],
        1,
        "The parser rejects invalid tool arguments before the application tool executes.",
      ],
    ],
  },
] as const;

const practice = [
  [
    "Write two variable declarations: a count you will increment and a fixed label. Which type errors could arise?",
    "Example: let count = 0; const label = 'turns'; count += 1. count = 'one' is a type error; label = 'other' is a rebinding error.",
  ],
  [
    "Write an array of three roles and use map to produce their uppercase names. What changes in the original array?",
    "Example: const upper = roles.map(role => role.toUpperCase()); roles is unchanged; upper is a new array.",
  ],
  [
    "Define an object with required content and an optional timestamp. Safely get the timestamp's year.",
    "Example: type Entry = { content: string; at?: string }; const year = entry.at?.slice(0, 4); year can be undefined.",
  ],
  [
    "Write a function that accepts messages and returns only assistant messages; say what the callback returns.",
    "Example: const assistants = (items: Message[]) => items.filter(m => m.role === 'assistant'); the callback returns boolean.",
  ],
  [
    "Add a third status to Result. Find the code that must change to handle it safely.",
    "Add a third variant and update show to narrow it explicitly; accessing value or reason without checking the status is unsafe.",
  ],
  [
    "Sketch a Counter class starting at 3. Predict two calls to next(), then explain where its state lives.",
    "The calls yield 4 then 5. The instance field belongs to that Counter, not to every instance or the type itself.",
  ],
  [
    "Call an async function from another module. Identify where await is needed and where JSON still needs validation.",
    "Example: const message = await readMessage(); await unwraps its Promise, but the network JSON still needs runtime checking.",
  ],
  [
    "Add a read-only method to RuntimeHost. Say what its return type should be and which object implements it.",
    "Example: gadgetPageText(id: string): Promise<string>; LearningSession supplies the implementation, while tools see only the host contract.",
  ],
  [
    "Trace malformed tool arguments through adapt. Which line rejects them before any side effect?",
    "v.parse(tool.input, args) throws before tool.run, so the invalid payload never reaches the application tool.",
  ],
  [
    "Design a read-only tool taking a session ID. Name the input schema and explain why replay: safe applies.",
    "Example: Type.Object({ id: Type.String({ maxLength: 100 }) }); a pure read may be replayed without duplicating a write.",
  ],
  [
    "Mark one LearningSession field as disposable and one as durable. What happens on object eviction?",
    "this.harness is disposable process memory; SQLite-backed conversation/gadget state remains and can be reopened.",
  ],
  [
    "Write the order of open, root and submit. What would an HTTP caller still need to learn after submit?",
    "Harness.open → harness.root → root.submit. The caller still needs the completion events or final visible entry.",
  ],
  [
    "Explain why a raw reasoning event should not be copied into SessionSnapshot.messages.",
    "Events include internal work. entryMessage projects approved visible user/assistant text; reasoning and raw provider data stay private.",
  ],
  [
    "Place a new read-only tool in the correct layers: contract, registration, capability implementation, test.",
    "Add the RuntimeHost signature, defineTool registration and validation, LearningSession capability, then a worker test for valid and invalid inputs.",
  ],
  [
    "For the POST route, label validation, identity, lookup and agent work in their execution order.",
    "Access/identity middleware → validate body → ensure owner-checked session → submit. A bad body never reaches submit.",
  ],
  [
    "A browser retries the same requestId. Explain what must not be duplicated and what 202 does not mean.",
    "Do not create a second input/turn. 202 confirms accepted work, not a completed answer.",
  ],
  [
    "Draw the three objects involved after session lookup: LearningSession, Harness and root conversation.",
    "LearningSession owns storage and capabilities; Harness connects Pi to that storage; root is the conversation receiving the input.",
  ],
  [
    "A model gives a tool malformed JSON. Trace whether tool.run and evidence retention happen.",
    "v.parse rejects the input first. tool.run and the subsequent retained source record do not run for that invalid call.",
  ],
  [
    "A tool finishes but the browser has no answer yet. What additional event or entry should you look for?",
    "Look for a completed assistant entry projected into visible text; a tool result alone is not the final user-facing answer.",
  ],
  [
    "An external write times out after being sent. Write the safe next step instead of blindly retrying.",
    "Treat it as uncertain, inspect the durable receipt and external state, then decide whether anything remains to do.",
  ],
  [
    "Explain the entire request path in seven arrows and mark one ownership check and one runtime validation.",
    "POST → Access/ensure owner → LearningSession.submit → Harness/root → v.parse for tool input → events → visible assistant entry.",
  ],
] as const;
export const COURSE_LESSON_COUNT = lessons.length;
export const COURSE_PRACTICE_COUNT = practice.length;
export const COURSE_ANSWER_KEYS = lessons.map((lesson) =>
  lesson.qs.map((question) => question[2]),
);
/** The source is loaded as a sandboxed Worker class by LearningGadgets, not eval'd in the app. */
export const TYPESCRIPT_COURSE_SOURCE = `import { DurableObject } from "cloudflare:workers";
const lessons = ${JSON.stringify(lessons.map((lesson, i) => ({ ...lesson, practice: practice[i] })))};
const escape = (s) => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
export class Gadget extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS course_answers(day INTEGER NOT NULL, slot INTEGER NOT NULL, choice INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(day,slot))');
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS course_profile(id INTEGER PRIMARY KEY CHECK(id=1), experience TEXT NOT NULL, goal TEXT NOT NULL)');
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS course_position(id INTEGER PRIMARY KEY CHECK(id=1), day INTEGER NOT NULL)');
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS course_practice(day INTEGER PRIMARY KEY, note TEXT NOT NULL)');
  }
  async render() {
    const rows = this.ctx.storage.sql.exec('SELECT day,slot,choice,attempts FROM course_answers').toArray();
    const answers = new Map(rows.map(r => [r.day + ':' + r.slot, r]));
    const profile = this.ctx.storage.sql.exec('SELECT experience,goal FROM course_profile WHERE id=1').toArray()[0];
    const note = this.ctx.storage.sql.exec('SELECT note FROM course_practice WHERE day=?', this.ctx.storage.sql.exec('SELECT day FROM course_position WHERE id=1').toArray()[0]?.day ?? 0).toArray()[0]?.note;
    const completed = lessons.map((l,i) => l.qs.every((q,j) => answers.get(i+':'+j)?.choice === q[2]));
    const current = this.ctx.storage.sql.exec('SELECT day FROM course_position WHERE id=1').toArray()[0]?.day ?? 0;
    const week = Math.floor(current / 7)+1, l = lessons[current];
    const missed = rows.filter(r => r.attempts > 1 && r.day < current).slice(-3);
    const review = missed.length ? '<aside><h2>Review from earlier days</h2>' + missed.map(r => '<p>Day '+ (r.day+1) + ': '+ escape(lessons[r.day].title) + ' — revisit its explanation if it still feels unclear.</p>').join('') + '</aside>' : '';
    const questions = l.qs.map((q, j) => {
      const response = answers.get(current+':'+j), chosen = response?.choice;
      return '<section class="question"><h2>' + (j === 0 ? 'Predict' : 'Apply / fix') + ': '+escape(q[0])+'</h2><form method="post"><input type="hidden" name="_action" value="answer"><input type="hidden" name="day" value="'+current+'"><input type="hidden" name="slot" value="'+j+'"><fieldset><legend>Choose one, then check why</legend>' + q[1].map((option,k) => '<label><input type="radio" name="choice" value="'+k+'" required '+(chosen===k?'checked':'')+'> '+escape(option)+'</label>').join('') + '</fieldset><button type="submit">Check answer</button></form>' + (response ? '<p class="feedback '+(chosen===q[2]?'correct':'incorrect')+'">'+(chosen===q[2]?'Correct':'Not yet')+'. '+escape(q[3])+'</p>' : '')+'</section>';
    }).join('');
    const count = completed.filter(Boolean).length;
    return '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>TypeScript · Pi learning course</title><style>body{font:16px/1.55 system-ui,sans-serif;color:#e9eef7;background:#111827;margin:0 auto;padding:20px;max-width:680px}a{color:#a5d8ff}h1{font-size:1.6rem}h2{font-size:1.1rem}.meta{color:#b9c7d7}section,aside{background:#202b3b;border:1px solid #425166;border-radius:12px;padding:16px;margin:16px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#111827;border-radius:8px;padding:14px;color:#d7ebff}fieldset{border:0;padding:0;margin:8px 0}label{display:block;padding:8px 0}input:not([type=radio]){display:block;box-sizing:border-box;width:100%;padding:10px;font:inherit;border:1px solid #8290a3;border-radius:8px}textarea{font:inherit}progress{width:100%}button{background:#84c7ff;color:#061321;border:0;border-radius:8px;padding:10px 16px;font-weight:700;min-height:44px}.feedback{border-left:4px solid #efb775;padding:8px}.correct{border-color:#69d7ad}.question{background:#182333}</style></head><body><h1>TypeScript for AI harnesses</h1><p class="meta">Week '+week+' · Day '+(current+1)+' of '+lessons.length+' · '+count+' completed</p><progress value="'+count+'" max="'+lessons.length+'" aria-label="Course progress"></progress><p>Week 1: TypeScript basics · Week 2: Pi Durable harness · Week 3: real request flow. Week 4 is intentionally not defined yet.</p>' + (!profile ? '<section><h2>Set your context</h2><p>This shapes the examples you discuss with your tutor; it does not skip the basics.</p><form method="post"><input type="hidden" name="_action" value="profile"><label>My experience <input name="experience" maxlength="180" required></label><label>My goal <input name="goal" maxlength="180" required></label><button>Save context</button></form></section>' : '<p class="meta">Your context: '+escape(profile.experience)+' · Goal: '+escape(profile.goal)+'</p>')+'<section><h2>Day '+(current+1)+': '+escape(l.title)+'</h2><p>'+escape(l.focus)+'</p><p class="meta">Source: '+escape(l.source)+'</p><pre><code>'+escape(l.code)+'</code></pre><p>'+escape(l.explain)+'</p></section>'+questions+'<section><h2>Write it yourself · ungraded</h2><p>'+escape(l.practice[0])+'</p><p>Your answer is saved privately in this gadget and is never executed.</p><form method="post"><input type="hidden" name="_action" value="practice"><textarea name="note" rows="4" maxlength="1200" style="box-sizing:border-box;width:100%;border-radius:8px;padding:8px" required>'+escape(note ?? '')+'</textarea><button type="submit">Save and reveal worked answer</button></form>'+(note ? '<p class="feedback">Worked answer: '+escape(l.practice[1])+'</p>' : '')+'</section>'+review+(completed[current]&&current<lessons.length-1?'<p class="correct">Day complete. Review both explanations, then continue.</p><form method="post"><input type="hidden" name="_action" value="next"><button>Next day</button></form>':'')+(completed[current]&&current===lessons.length-1?'<p>Three-week course complete. Agree the Week 4 goal with your tutor before adding further lessons.</p>':'')+'</body></html>';
  }
  async handleAction(action, data) {
    if (action === 'profile') {
      if (typeof data.experience !== 'string' || !data.experience.trim() || data.experience.length > 180 || typeof data.goal !== 'string' || !data.goal.trim() || data.goal.length > 180) throw new Error('Invalid profile');
      this.ctx.storage.sql.exec('INSERT INTO course_profile(id,experience,goal) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET experience=excluded.experience,goal=excluded.goal', data.experience.trim(), data.goal.trim());
      return;
    }
    if (action === 'practice') {
      const day = this.ctx.storage.sql.exec('SELECT day FROM course_position WHERE id=1').toArray()[0]?.day ?? 0;
      if (typeof data.note !== 'string' || !data.note.trim() || data.note.length > 1200) throw new Error('Invalid practice');
      this.ctx.storage.sql.exec('INSERT INTO course_practice(day,note) VALUES(?,?) ON CONFLICT(day) DO UPDATE SET note=excluded.note',day,data.note.trim());
      return;
    }
    if (action === 'next') {
      const day = this.ctx.storage.sql.exec('SELECT day FROM course_position WHERE id=1').toArray()[0]?.day ?? 0;
      const rows = this.ctx.storage.sql.exec('SELECT slot,choice FROM course_answers WHERE day=?',day).toArray();
      if (day >= lessons.length - 1 || !lessons[day].qs.every((q,j) => rows.some(r => r.slot===j && r.choice===q[2]))) throw new Error('Finish the day first');
      this.ctx.storage.sql.exec('INSERT INTO course_position(id,day) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET day=excluded.day',day+1);
      return;
    }
    if (action !== 'answer') throw new Error('Invalid action');
    const day = Number(data.day), slot = Number(data.slot), choice = Number(data.choice);
    if (typeof data.day !== 'string' || typeof data.slot !== 'string' || typeof data.choice !== 'string' || String(day) !== data.day || String(slot) !== data.slot || String(choice) !== data.choice || !Number.isSafeInteger(day) || !Number.isSafeInteger(slot) || !Number.isSafeInteger(choice) || slot < 0 || slot > 1 || choice < 0 || choice > 2 || day < 0 || day >= lessons.length) throw new Error('Invalid answer');
    const current = this.ctx.storage.sql.exec('SELECT day FROM course_position WHERE id=1').toArray()[0]?.day ?? 0;
    if (day !== current) throw new Error('Lesson is locked');
    this.ctx.storage.sql.exec('INSERT INTO course_answers(day,slot,choice,attempts) VALUES(?,?,?,1) ON CONFLICT(day,slot) DO UPDATE SET choice=excluded.choice,attempts=attempts+1',day,slot,choice);
  }
}`;

export const COURSE_PREFLIGHT = [
  {
    action: "profile",
    data: { experience: "Harness learner", goal: "Read Pi Durable" },
    expectText: "Your context: Harness learner",
    expectFeedback: "Read Pi Durable",
  },
  {
    action: "answer",
    data: { day: "0", slot: "0", choice: "0" },
    expectText: "Not yet",
    expectFeedback: "The addition changes the number value",
  },
  {
    action: "answer",
    data: { day: "0", slot: "1", choice: "2" },
    expectText: "Correct",
    expectFeedback: "count was inferred as number",
  },
] as const;
