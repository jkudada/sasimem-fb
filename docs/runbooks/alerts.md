# Alerts for the tick

The hourly tick drafts, requests approval, sends and reminds. If it stops, nothing goes out
and nobody notices (plan §12). Two alerts:

| Policy | Fires when | Notes |
|---|---|---|
| Sasimem tick failed (`<project>`) | the `tick` service logs anything at ERROR or above | at most one email an hour; closes itself after a day |
| Sasimem tick silent for 3 hours (`<project>`) | the `tick_done` metric counts nothing for 3 hours | the tick runs hourly, so this is three missed runs in a row |

`tick_done` is a log-based metric. It counts the one structured line a successful tick logs
(`{"event": "tick_done", "drafted": …, "sent": …}`, from `tickAndLog` in `functions/src/tick.ts`).
A tick that throws logs no such line, and its error triggers the first policy.

```sh
node ops/alerts.ts --project <id> [--email <address>]
```

The script creates or updates the metric and both policies, found by name, so it is safe to rerun.
With `--email`, both policies notify that address. Without it they open incidents in the console
only.

## When one fires

1. Open Cloud Run → `tick` → Logs, or Logs Explorer with `resource.labels.service_name="tick"`.
2. Cloud Scheduler retries a failed tick 3 times. Every step is safe to rerun: claims are
   compare-and-set, and only the tick that wins a claim sends email (I6, I8).
3. One landlord's failure does not stop the others. The failed send is in that org's
   email log as `failed`, with the reason.
4. To run the tick at once: Cloud Scheduler → the job for `tick` → Force run.

## sasimem-dev, 2026-11-08

The metric and both policies were created with no email address, and a second run updated
them in place. Nothing is deployed to dev yet, so the "silent" policy will open an incident
there. That is expected, and nobody is notified.
