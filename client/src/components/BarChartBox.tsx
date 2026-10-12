import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { fmtNum } from '../lib/format';

const BAR = '#1f4e79';
const GRID = '#e4e7eb';
const INK = '#52606d';

/** Подписи оси: большие значения — сокращённо (тыс., млн, млрд). */
function axisFmt(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e9) return `${fmtNum(v / 1e9, 1)} млрд`;
  if (a >= 1e6) return `${fmtNum(v / 1e6, 1)} млн`;
  if (a >= 1e4) return `${fmtNum(v / 1e3, 0)} тыс.`;
  return fmtNum(v, 1);
}

interface Props {
  data: Record<string, any>[];
  x: string;
  y: string;
  /** Подпись значения во всплывающей подсказке. */
  valueLabel: string;
  unit?: string;
  horizontal?: boolean;
  height?: number;
  onClick?: (row: Record<string, any>) => void;
}

/** Однорядная столбчатая диаграмма: один тон, тонкие столбцы, подсказка при наведении. */
export default function BarChartBox({ data, x, y, valueLabel, unit = '', horizontal, height, onClick }: Props) {
  const h = height ?? (horizontal ? Math.max(160, data.length * 28 + 40) : 260);
  const tooltip = (
    <Tooltip
      cursor={{ fill: 'rgba(31,78,121,0.06)' }}
      formatter={(v: number) => [`${fmtNum(v, 2)}${unit ? ' ' + unit : ''}`, valueLabel]}
      labelStyle={{ color: '#1f2933', fontWeight: 600 }}
      contentStyle={{ borderRadius: 6, borderColor: GRID, fontSize: 13 }}
    />
  );
  return (
    <div style={{ width: '100%', height: h }}>
      <ResponsiveContainer>
        {horizontal ? (
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 24, bottom: 4, left: 4 }} barCategoryGap={6}>
            <CartesianGrid horizontal={false} stroke={GRID} />
            <XAxis type="number" tick={{ fill: INK, fontSize: 12 }} axisLine={false} tickLine={false} tickFormatter={axisFmt} />
            <YAxis type="category" dataKey={x} width={150} tick={{ fill: INK, fontSize: 12 }} axisLine={false} tickLine={false} interval={0} />
            {tooltip}
            <Bar dataKey={y} fill={BAR} radius={[0, 4, 4, 0]} maxBarSize={18} onClick={(d) => onClick?.(d as any)} cursor={onClick ? 'pointer' : undefined} />
          </BarChart>
        ) : (
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 0 }} barCategoryGap="20%">
            <CartesianGrid vertical={false} stroke={GRID} />
            <XAxis dataKey={x} tick={{ fill: INK, fontSize: 12 }} axisLine={{ stroke: GRID }} tickLine={false} interval="preserveStartEnd" />
            <YAxis tick={{ fill: INK, fontSize: 12 }} axisLine={false} tickLine={false} width={64} tickFormatter={axisFmt} />
            {tooltip}
            <Bar dataKey={y} fill={BAR} radius={[4, 4, 0, 0]} maxBarSize={36} onClick={(d) => onClick?.(d as any)} cursor={onClick ? 'pointer' : undefined} />
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
