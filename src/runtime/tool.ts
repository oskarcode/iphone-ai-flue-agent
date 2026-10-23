import * as v from "valibot";

/** Framework-neutral tool definitions. Pi validates its JSON schema and this boundary
 * validates the original Valibot schema before any external effects. */
/** Input: typed Valibot schema and executor. Output: the same framework-neutral definition.
 * What this function does: preserves inference for tools shared by Pi adapters, approval execution and tests.
 */
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
