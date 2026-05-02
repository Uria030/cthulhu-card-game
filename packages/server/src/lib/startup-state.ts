let lastMigrationError: any = null;
let startupTimestamp: string | null = null;

export function setLastMigrationError(err: any) {
  lastMigrationError = err;
}

export function getLastMigrationError() {
  return lastMigrationError;
}

export function setStartupTimestamp(ts: string) {
  startupTimestamp = ts;
}

export function getStartupTimestamp() {
  return startupTimestamp;
}
