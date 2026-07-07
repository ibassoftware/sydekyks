import { useState } from "react";
import type { LedgerDailyTrend } from "../../lib/api";

// Status pair validated against the dark ink surface (OKLCH lightness band 0.48-0.67,
// CVD deuteranopia ΔE 12.4 — see dataviz skill run). Reused, not eyeballed.
const SUCCEEDED_COLOR = "#b3891c"; // gold-600
const FAILED_COLOR = "#ef4444"; // red-500

const WIDTH = 640;
const HEIGHT = 150;
const PAD_TOP = 10;
const PAD_BOTTOM = 20;
const MAX_BAR_WIDTH = 16;
const SEGMENT_GAP = 2;

function formatDay(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}

/** A rect with rounded top corners and a square baseline — the "data-end" spec applied only to
 * the topmost segment of a stack (interior segments stay square; the surface gap separates them). */
function TopRoundedRect({
  x, y, width, height, fill, roundTop = true,
}: { x: number; y: number; width: number; height: number; fill: string; roundTop?: boolean }) {
  if (height <= 0) return null;
  if (!roundTop) return <rect x={x} y={y} width={width} height={height} fill={fill} />;
  const r = Math.min(3, height / 2, width / 2);
  const d = `M${x},${y + height} V${y + r} Q${x},${y} ${x + r},${y} H${x + width - r} Q${x + width},${y} ${x + width},${y + r} V${y + height} Z`;
  return <path d={d} fill={fill} />;
}

export function LedgerTrendChart({ trend }: { trend: LedgerDailyTrend[] }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);

  const n = trend.length;
  const maxTotal = Math.max(1, ...trend.map((d) => d.succeeded + d.failed));
  const chartH = HEIGHT - PAD_TOP - PAD_BOTTOM;
  const bandWidth = WIDTH / n;
  const barWidth = Math.min(MAX_BAR_WIDTH, bandWidth - 2);
  const scale = chartH / maxTotal;
  const baseline = HEIGHT - PAD_BOTTOM;

  // Label every ~5th day so 30 ticks don't collide.
  const tickEvery = Math.max(1, Math.round(n / 6));

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-4 text-xs text-[#b9ad98]">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: SUCCEEDED_COLOR }} />
            Succeeded
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: FAILED_COLOR }} />
            Failed
          </span>
        </div>
        <button
          onClick={() => setShowTable((v) => !v)}
          className="text-xs text-[#8a7f6d] underline decoration-dotted hover:text-[#d8cdb9]"
        >
          {showTable ? "View chart" : "View as table"}
        </button>
      </div>

      {showTable ? (
        <div className="max-h-48 overflow-y-auto rounded-md border border-ink-700">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-ink-800 text-[#8a7f6d]">
              <tr>
                <th className="px-3 py-1.5 font-semibold">Date</th>
                <th className="px-3 py-1.5 font-semibold">Succeeded</th>
                <th className="px-3 py-1.5 font-semibold">Failed</th>
              </tr>
            </thead>
            <tbody>
              {trend
                .filter((d) => d.succeeded > 0 || d.failed > 0)
                .map((d) => (
                  <tr key={d.date} className="border-t border-ink-700/60 text-[#ede6da]">
                    <td className="px-3 py-1.5">{formatDay(d.date)}</td>
                    <td className="px-3 py-1.5 tabular-nums">{d.succeeded}</td>
                    <td className="px-3 py-1.5 tabular-nums">{d.failed}</td>
                  </tr>
                ))}
              {trend.every((d) => d.succeeded === 0 && d.failed === 0) && (
                <tr>
                  <td colSpan={3} className="px-3 py-3 text-center text-[#8a7f6d]">
                    No missions in the last 30 days.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative">
          <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full" style={{ height: HEIGHT }}>
            {/* baseline */}
            <line x1={0} y1={baseline} x2={WIDTH} y2={baseline} stroke="#3a352c" strokeWidth={1} />
            {trend.map((d, i) => {
              const cx = i * bandWidth + bandWidth / 2;
              const x = cx - barWidth / 2;
              const succH = d.succeeded * scale;
              const failH = d.failed * scale;
              const gap = d.succeeded > 0 && d.failed > 0 ? SEGMENT_GAP : 0;
              const isHovered = hovered === i;
              return (
                <g
                  key={d.date}
                  opacity={hovered === null || isHovered ? 1 : 0.55}
                  onMouseEnter={() => setHovered(i)}
                  onMouseLeave={() => setHovered(null)}
                  onFocus={() => setHovered(i)}
                  onBlur={() => setHovered(null)}
                  tabIndex={d.succeeded || d.failed ? 0 : -1}
                  role="img"
                  aria-label={`${formatDay(d.date)}: ${d.succeeded} succeeded, ${d.failed} failed`}
                >
                  {/* transparent hit area, bigger than the visible bar */}
                  <rect x={cx - bandWidth / 2} y={0} width={bandWidth} height={HEIGHT} fill="transparent" />
                  {d.succeeded > 0 && (
                    <TopRoundedRect
                      x={x} y={baseline - succH} width={barWidth} height={succH} fill={SUCCEEDED_COLOR}
                      roundTop={d.failed === 0}
                    />
                  )}
                  {d.failed > 0 && (
                    <TopRoundedRect
                      x={x}
                      y={baseline - succH - gap - failH}
                      width={barWidth}
                      height={failH}
                      fill={FAILED_COLOR}
                    />
                  )}
                  {i % tickEvery === 0 && (
                    <text x={cx} y={HEIGHT - 4} textAnchor="middle" fontSize={9} fill="#8a7f6d">
                      {formatDay(d.date)}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>

          {hovered !== null && (
            <div
              className="pointer-events-none absolute top-0 rounded-md border border-ink-700 bg-ink-900 px-2.5 py-1.5 text-xs shadow-lg"
              style={{
                left: `${((hovered + 0.5) / n) * 100}%`,
                transform: "translate(-50%, -100%)",
              }}
            >
              <p className="font-semibold text-[#ede6da]">{formatDay(trend[hovered].date)}</p>
              <p style={{ color: SUCCEEDED_COLOR }}>
                <span className="font-semibold">{trend[hovered].succeeded}</span> succeeded
              </p>
              <p style={{ color: FAILED_COLOR }}>
                <span className="font-semibold">{trend[hovered].failed}</span> failed
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
