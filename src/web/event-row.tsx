import type { DashboardEvent } from "../domain";
import { ExternalIcon } from "./icons";
import { formatDateTime } from "./status-presentation";

export function EventRow({ event }: { event: DashboardEvent }) {
  const labels = {
    opened: event.kind === "maintenance" ? "メンテナンス予定" : "障害発生",
    updated: event.kind === "maintenance" ? "メンテナンス更新" : "障害更新",
    resolved: event.kind === "maintenance" ? "メンテナンス完了" : "復旧",
  };
  return (
    <li className={`event-row event-${event.eventKind}`}>
      <span className="event-mark" aria-hidden="true" />
      <div className="event-copy">
        <div className="event-meta">
          <span>{event.serviceName}</span>
          <span>{labels[event.eventKind]}</span>
        </div>
        <p>
          {event.url ? (
            <a href={event.url} target="_blank" rel="noreferrer noopener">
              {event.title}
              <ExternalIcon />
            </a>
          ) : (
            event.title
          )}
        </p>
        {event.officialEventAt && <small>公式時刻 {formatDateTime(event.officialEventAt)}</small>}
      </div>
    </li>
  );
}
