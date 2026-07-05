export interface LogActor {
  id: string;
  name: string;
  label?: string;
}

export interface LogStatusRow {
  id: string;
  name: string;
  label?: string;
  line: string;
  waiting: boolean;
}

export function latestActionRows(actors: LogActor[], log: string[]): LogStatusRow[] {
  return actors.map((actor) => {
    const prefix = `[${actor.name}]`;
    for (let i = log.length - 1; i >= 0; i -= 1) {
      const line = log[i];
      if (line.startsWith(prefix)) {
        return {
          ...actor,
          line: line.slice(prefix.length).trim() || '正在行動',
          waiting: false,
        };
      }
    }
    return {
      ...actor,
      line: '等待',
      waiting: true,
    };
  });
}
