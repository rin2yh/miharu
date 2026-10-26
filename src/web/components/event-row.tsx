import type { DashboardEvent } from "../../domain";
import { ExternalIcon } from "./icons";
import { formatDateTime, incidentCategoryLabel } from "../presentation/status-presentation";

export function EventRow({ event }: { event: DashboardEvent }) {
  const category = incidentCategoryLabel(event.displayCategory);
  const labels = {
    opened:
      event.displayCategory === "maintenance"
        ? "メンテナンス予定"
        : `${category}${event.displayCategory === "outage" ? "発生" : "掲載"}`,
    updated: `${category}更新`,
    resolved: event.displayCategory === "outage" ? "復旧" : `${category}完了`,
    closed: "追跡終了",
  };
  return (
    <li className="relative flex min-h-20 gap-3 border-b border-line py-4 pr-1.5 pl-1">
      <span
        className={`mt-1 h-2 w-2 shrink-0 rounded-full border-2 bg-page ${event.eventKind === "resolved" ? "border-healthy" : "border-event-mark"}`}
        aria-hidden="true"
      />
      <div className="min-w-0">
        <div className="flex flex-wrap gap-2 text-xs font-semibold text-muted">
          <span>{event.serviceName}</span>
          <span className="border-l border-line-strong pl-2">{labels[event.eventKind]}</span>
        </div>
        <p className="mt-1 mb-1 text-xs leading-normal text-ink [overflow-wrap:anywhere]">
          {event.url ? (
            <a
              className="ml-1 decoration-line-strong underline-offset-2 hover:text-healthy"
              href={event.url}
              target="_blank"
              rel="noreferrer noopener"
            >
              {event.title}
              <ExternalIcon />
            </a>
          ) : (
            event.title
          )}
        </p>
        {event.officialEventAt && (
          <small className="text-xs tabular-nums text-quiet">
            公式時刻 {formatDateTime(event.officialEventAt)}
          </small>
        )}
      </div>
    </li>
  );
}
