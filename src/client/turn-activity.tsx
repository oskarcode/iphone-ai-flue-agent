// React renders a native keyboard/touch-accessible disclosure; server DTOs contain sanitized progress only.
import type { TurnActivity } from "../runtime/contracts.ts";

const STATUS = {
  queued: "Queued",
  running: "Working",
  done: "Complete",
  interrupted: "Interrupted",
};
/** Input: one input submission's operational journal, if recorded. Output: a collapsed per-turn panel.
 * What this function does: shows current progress immediately in the summary and retains expandable event history.
 */
export function TurnActivityPanel({ activity }: { activity?: TurnActivity }) {
  const current = activity?.steps
    .filter((step) => step.status === "running")
    .at(-1);
  return (
    <details
      className="turn-activity"
      data-status={activity?.status ?? "unavailable"}
    >
      <summary>
        <span>Agent activity</span>
        <span className="activity-status" role="status">
          {activity ? STATUS[activity.status] : "Not recorded"}
          {activity?.status === "running" && current
            ? ` · ${current.label}`
            : ""}
        </span>
      </summary>
      {!activity ? (
        <p>Activity was not recorded for this older turn.</p>
      ) : (
        <>
          <p className="muted">
            Operational updates only — no private reasoning or raw tool
            payloads.
          </p>
          {!activity.steps.length && (
            <p>
              {activity.status === "queued"
                ? "Waiting for the current turn to finish."
                : "No detailed events were retained."}
            </p>
          )}
          {activity.truncated && (
            <p className="muted">Showing the latest 80 activity steps.</p>
          )}
          <ol>
            {activity.steps.map((step) => (
              <li key={step.id} data-status={step.status}>
                <span>{step.label}</span>
                <small>
                  {step.status === "error"
                    ? "Needs attention"
                    : step.status === "done"
                      ? "Done"
                      : step.status === "interrupted"
                        ? "Interrupted"
                        : step.status === "queued"
                          ? "Queued"
                          : "In progress"}
                </small>
              </li>
            ))}
          </ol>
          {activity.status === "interrupted" && (
            <p>
              This turn stopped before completing. Check the conversation before
              retrying.
            </p>
          )}
        </>
      )}
    </details>
  );
}
