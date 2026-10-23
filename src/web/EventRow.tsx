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
    <li className="relative flex min-h-[82px] gap-[13px] border-b border-line py-[15px] pr-[6px] pl-[3px]">
      <span
        className={`mt-1 h-[9px] w-[9px] shrink-0 rounded-full border-2 bg-page ${event.eventKind === "resolved" ? "border-healthy" : "border-event-mark"}`}
        aria-hidden="true"
      />
      <div className="min-w-0">
        <div className="flex flex-wrap gap-[9px] text-[10px] font-semibold text-muted">
          <span>{event.serviceName}</span>
          <span className="border-l border-line-strong pl-[9px]">{labels[event.eventKind]}</span>
        </div>
        <p className="mt-[4px] mb-[3px] text-xs leading-[1.55] text-ink [overflow-wrap:anywhere]">
          {event.url ? (
            <a
              className="ml-1 decoration-[#b8c5bd] underline-offset-[3px] hover:text-healthy"
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
          <small className="text-[10px] tabular-nums text-quiet">
            公式時刻 {formatDateTime(event.officialEventAt)}
          </small>
        )}
      </div>
    </li>
  );
}
