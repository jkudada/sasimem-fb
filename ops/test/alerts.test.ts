import { describe, expect, test } from "vitest";
import { TICK_SERVICE, tickDoneMetric, tickFailedPolicy, tickSilentPolicy } from "../src/alerts.ts";

// A v2 function runs as a Cloud Run service named after it.
const TICK = `resource.type="cloud_run_revision" AND resource.labels.service_name="${TICK_SERVICE}"`;

describe("alerts for a tick that fails or stops (plan §12)", () => {
  test("a log-based metric counts the tick's \"tick done\" lines", () => {
    expect(tickDoneMetric()).toEqual({
      name: "tick_done",
      description: "One per successful Sasimem tick (functions/src/tick.ts tickAndLog).",
      filter: `${TICK} AND jsonPayload.event="tick_done"`,
      metricDescriptor: { metricKind: "DELTA", valueType: "INT64", unit: "1" },
    });
  });

  test("any error from the tick alerts at once, at most once an hour", () => {
    const p = tickFailedPolicy("sasimem-dev", ["projects/sasimem-dev/notificationChannels/7"]);
    expect(p.displayName).toBe("Sasimem tick failed (sasimem-dev)");
    expect(p.conditions).toEqual([{ displayName: "The tick logged an error", conditionMatchedLog: { filter: `${TICK} AND severity>=ERROR` } }]);
    expect(p.alertStrategy).toEqual({ notificationRateLimit: { period: "3600s" }, autoClose: "86400s" });
    expect(p.notificationChannels).toEqual(["projects/sasimem-dev/notificationChannels/7"]);
    expect(p.combiner).toBe("OR");
  });

  test("no successful tick for 3 hours alerts", () => {
    const p = tickSilentPolicy("sasimem-dev", []);
    expect(p.displayName).toBe("Sasimem tick silent for 3 hours (sasimem-dev)");
    expect(p.conditions).toEqual([{
      displayName: "No \"tick done\" for 3 hours",
      conditionAbsent: {
        filter: `metric.type="logging.googleapis.com/user/tick_done" AND resource.type="cloud_run_revision"`,
        duration: "10800s",
        aggregations: [{ alignmentPeriod: "3600s", perSeriesAligner: "ALIGN_SUM", crossSeriesReducer: "REDUCE_SUM" }],
      },
    }]);
    expect(p.notificationChannels).toEqual([]);
  });
});
