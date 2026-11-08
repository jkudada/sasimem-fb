# Restoring Firestore, and the restore drill

The `(default)` database has point-in-time recovery (PITR, 7 days) and daily backups kept
98 days (14 weeks). It also has delete protection. These are tax documents (plan §10 rec. 5).

## The drill

```sh
node ops/restore-drill.ts --project <id>                                # the newest backup
node ops/restore-drill.ts --project <id> --pitr 2026-11-08T02:53:00Z    # a point in time
```

The drill:
1. restores the newest backup, or clones `(default)` as it was at the given minute, into a
   scratch database named `drill-backup-YYYYMMDD-HHMM` or `drill-pitr-…`;
2. reads every document in it, including subcollections;
3. reads `(default)` **as it was at the same moment**, using a PITR read, and requires every path and
   field to match. PITR reads older than an hour are whole minutes only, so a backup is compared
   with the minutes either side of its snapshot time;
4. deletes the scratch database, even when the comparison fails. A restored copy inherits delete
   protection, which the drill turns off on its own copy. It refuses to delete anything not named
   `drill-…`.

It never writes to `(default)`. It exits 1 on any difference.

**Cost and time.** A scratch database is billed like any other while it exists: storage plus
the reads of the comparison, which is cents at this size. A backup restore of a small database
took about 12 s. A PITR clone took far longer, with many minutes in "PROCESSING" (see the log below).

## A real restore

Never restore over `(default)`. Restore into a new database, check it, then either:
- copy the documents you need back with a script (for a few bad edits); or
- point the app at the new database. This needs a deploy, and `(default)` is the only database the
  app knows, so prefer copying back.

```sh
# list backups
curl -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  https://firestore.googleapis.com/v1/projects/<id>/locations/australia-southeast1/backups
# restore one into a new database
gcloud firestore databases restore --project <id> --source-backup=<backup name> --destination-database=restore-<date>
# or clone a moment within the last 7 days
gcloud firestore databases clone --project <id> --source-database='projects/<id>/databases/(default)' \
  --snapshot-time=<whole minute, UTC> --destination-database=restore-<date>
```

## Drill log

| Date | Project | Kind | Result |
|---|---|---|---|
