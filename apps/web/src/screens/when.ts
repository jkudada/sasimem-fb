/** "8:00 am on 1 October 2026", in the landlord's time zone, whatever the phone's. */
export function sendLabel(at: Date, timezone: string): string {
  const f = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-AU", { timeZone: timezone, ...o }).format(at);
  return `${f({ hour: "numeric", minute: "2-digit", hour12: true })} on ${f({ day: "numeric", month: "long", year: "numeric" })}`;
}
