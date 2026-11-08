/**
 * Alerts for the tick (plan §12: "a scheduled job silently stops"). The tick logs one
 * structured "tick done" line per successful run (functions/src/tick.ts); a log-based
 * metric counts them. One policy fires on any error the tick logs, one when no success
 * has been counted for 3 hours. Pure: ops/alerts.ts creates or updates them.
 */
export const TICK_SERVICE = "tick"; // a v2 function runs as the Cloud Run service of its name
const TICK = `resource.type="cloud_run_revision" AND resource.labels.service_name="${TICK_SERVICE}"`;

export const tickDoneMetric = () => ({
  name: "tick_done",
  description: "One per successful Sasimem tick (functions/src/tick.ts tickAndLog).",
  filter: `${TICK} AND jsonPayload.event="tick_done"`,
  metricDescriptor: { metricKind: "DELTA", valueType: "INT64", unit: "1" },
});

export interface AlertPolicy {
  displayName: string;
  combiner: "OR";
  conditions: object[];
  alertStrategy?: object;
  notificationChannels: string[];
  documentation: { content: string; mimeType: "text/markdown" };
}

const RUNBOOK = "See docs/runbooks/alerts.md in the sasimem-fb repository.";

export const tickFailedPolicy = (project: string, channels: readonly string[]): AlertPolicy => ({
  displayName: `Sasimem tick failed (${project})`,
  combiner: "OR",
  conditions: [{ displayName: "The tick logged an error", conditionMatchedLog: { filter: `${TICK} AND severity>=ERROR` } }],
  // A log-match policy must rate-limit; one email an hour while the tick keeps failing.
  alertStrategy: { notificationRateLimit: { period: "3600s" }, autoClose: "86400s" },
  notificationChannels: [...channels],
  documentation: { content: `The hourly tick failed. Cloud Scheduler retries it 3 times; every step is safe to rerun. ${RUNBOOK}`, mimeType: "text/markdown" },
});

export const tickSilentPolicy = (project: string, channels: readonly string[]): AlertPolicy => ({
  displayName: `Sasimem tick silent for 3 hours (${project})`,
  combiner: "OR",
  conditions: [{
    displayName: "No \"tick done\" for 3 hours",
    conditionAbsent: {
      filter: `metric.type="logging.googleapis.com/user/tick_done" AND resource.type="cloud_run_revision"`,
      duration: "10800s",
      aggregations: [{ alignmentPeriod: "3600s", perSeriesAligner: "ALIGN_SUM", crossSeriesReducer: "REDUCE_SUM" }],
    },
  }],
  notificationChannels: [...channels],
  documentation: { content: `No tick has succeeded for 3 hours: no invoices are drafted, sent or reminded. ${RUNBOOK}`, mimeType: "text/markdown" },
});
