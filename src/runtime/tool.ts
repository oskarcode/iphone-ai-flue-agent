import * as v from "valibot";

/** Framework-neutral tool definitions. Pi validates its JSON schema and this boundary
 * validates the original Valibot schema before any external effects. */
export function defineTool<S extends v.GenericSchema, O>(tool: {
  name: string;
  description: string;
  input: S;
  run: (input: {
    data: v.InferOutput<S>;
    signal?: AbortSignal;
    log: { info: (message: string) => void };
  }) => Promise<{ output: O }>;
}) {
  return tool;
}
