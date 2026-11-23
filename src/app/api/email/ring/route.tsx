import { ImageResponse } from "next/og";

// The site's progress ring (src/app/components/progressRing.tsx) as a PNG for emails, which
// cannot draw SVG. /api/email/ring?value=12&goal=20 draws 12 of 20 hrs; at or past the goal
// it turns green. Drawn at 2x so it stays sharp at the 120px the emails show it.
// Open to anyone (no site gate), since mail apps fetch it without a login. It shows only the
// two numbers in its own address.

const SIZE = 240;
const THICKNESS = 18;
const TICK_SPACE = 14;

const BLUE = "#164998";
const SILVER = "#c8ccd3";
const GRAY = "#5c6168";
const GREEN = "#1e7e34";

const number = (raw: string | null, max: number) => {
  const value = Number(raw);
  return Number.isFinite(value) ? Math.min(Math.max(value, 0), max) : 0;
};

const label = (value: number) => value.toLocaleString("en-US", { maximumFractionDigits: 1 });

export function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const goal = number(params.get("goal"), 100_000);
  const value = number(params.get("value"), 100_000);
  const pct = goal > 0 ? Math.min(1, value / goal) : 0;
  const met = goal > 0 && value >= goal;
  const color = met ? GREEN : BLUE;

  const center = SIZE / 2;
  const radius = (SIZE - THICKNESS) / 2 - TICK_SPACE;
  const circumference = 2 * Math.PI * radius;
  const at = (n: number) => Math.round(n * 100) / 100;

  const ticks = Array.from({ length: 12 }, (_, i) => {
    const angle = (i * Math.PI) / 6;
    const major = i % 3 === 0;
    const outer = SIZE / 2 - 2;
    const inner = outer - (major ? 12 : 8);
    return (
      <line
        key={i}
        x1={at(center + Math.sin(angle) * inner)}
        y1={at(center - Math.cos(angle) * inner)}
        x2={at(center + Math.sin(angle) * outer)}
        y2={at(center - Math.cos(angle) * outer)}
        stroke={color}
        strokeWidth={major ? 4 : 3}
      />
    );
  });

  const valueText = label(value);

  return new ImageResponse(
    (
      <div style={{ width: SIZE, height: SIZE, display: "flex", position: "relative", background: "transparent" }}>
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} style={{ position: "absolute", top: 0, left: 0 }}>
          {ticks}
          <circle cx={center} cy={center} r={radius} fill="none" stroke={SILVER} strokeWidth={THICKNESS} />
          {pct > 0 && (
            <circle
              cx={center}
              cy={center}
              r={radius}
              fill="none"
              stroke={color}
              strokeWidth={THICKNESS}
              strokeLinecap="round"
              strokeDasharray={`${at(circumference * pct)} ${at(circumference)}`}
              transform={`rotate(-90 ${center} ${center})`}
            />
          )}
        </svg>
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: SIZE,
            height: SIZE,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div style={{ fontSize: valueText.length > 4 ? 40 : 52, fontWeight: 700, lineHeight: 1, color }}>{valueText}</div>
          <div style={{ marginTop: 6, fontSize: 20, fontWeight: 600, color: GRAY }}>{`of ${label(goal)} hrs`}</div>
        </div>
      </div>
    ),
    {
      width: SIZE,
      height: SIZE,
      // The picture depends only on the address, so mail proxies can keep it for good
      headers: { "Cache-Control": "public, max-age=31536000, immutable" },
    },
  );
}
