import { useMemo, useState } from 'react';
import { extractPlaceName, type WritingVisual } from '../lib/types.ts';

export { extractPlaceName };

interface VisualRendererProps {
  visual: WritingVisual;
  className?: string;
}

export function VisualRenderer({ visual, className = '' }: VisualRendererProps) {
  const isMap = visual.type === 'process' && visual.caption.toLowerCase().includes('map') ||
    visual.columns.some((c) => c.toLowerCase().includes('zone') || c.toLowerCase().includes('area') || c.toLowerCase().includes('location') || c.toLowerCase().includes('boundary')) ||
    visual.caption.toLowerCase().includes('redevelopment') ||
    visual.caption.toLowerCase().includes('layout') ||
    visual.caption.toLowerCase().includes('town') ||
    visual.caption.toLowerCase().includes('campus');

  if (isMap) {
    return <MapVectorRenderer visual={visual} className={className} />;
  }

  if (visual.type === 'bar') {
    return <BarChartVectorRenderer visual={visual} className={className} />;
  }

  if (visual.type === 'line') {
    return <LineGraphVectorRenderer visual={visual} className={className} />;
  }

  if (visual.type === 'process') {
    return <ProcessVectorRenderer visual={visual} className={className} />;
  }

  return <TableVectorRenderer visual={visual} className={className} />;
}

/**
 * High-fidelity SVG / CSS Vector Map Renderer.
 * Simulates official IELTS Academic Task 1 map comparisons (e.g., town development, campus layout).
 */
function MapVectorRenderer({ visual, className }: VisualRendererProps) {
  const parsedZones = useMemo(() => {
    return visual.rows.map((row, idx) => ({
      name: row[0] || `Zone ${idx + 1}`,
      period1: row[1] || 'Past Feature',
      period2: row[2] || row[1] || 'Modern Feature',
    }));
  }, [visual]);

  return (
    <figure
      style={{
        margin: '16px 0',
        padding: 16,
        background: '#f8fafc',
        borderRadius: 8,
        border: '1px solid #cbd5e1',
        boxSizing: 'border-box',
      }}
      className={className}
    >
      <figcaption
        style={{
          fontWeight: 700,
          fontSize: '1rem',
          color: '#1e293b',
          marginBottom: 12,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          flexWrap: 'wrap',
          gap: 8,
        }}
      >
        <span>{visual.caption}</span>
        <span
          style={{
            fontSize: '0.8rem',
            padding: '2px 8px',
            background: '#e2e8f0',
            borderRadius: 4,
            color: '#475569',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            fontWeight: 600,
          }}
        >
          Vector Map Comparison
        </span>
      </figcaption>

      {/* Dual Panel Comparison Map: 1990 vs Present */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
        {/* Panel A: Historical State */}
        <div style={{ background: '#fff', border: '1px solid #cbd5e1', borderRadius: 6, padding: 12 }}>
          <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#334155', marginBottom: 8, textAlign: 'center' }}>
            Figure 1: {visual.columns[1] || 'Initial Layout (1995)'}
          </div>
          <svg viewBox="0 0 320 220" style={{ width: '100%', height: 'auto', display: 'block' }}>
            <rect width="320" height="220" fill="#f1f5f9" rx="4" />
            {/* Coastline / River */}
            <path d="M 0 160 Q 90 140 180 170 T 320 150 L 320 220 L 0 220 Z" fill="#bae6fd" />
            <text x="160" y="195" fill="#0369a1" fontSize="11" fontWeight="600" textAnchor="middle">
              Coastal Bay / Estuary
            </text>

            {/* Farmland / Green Zone */}
            <rect x="20" y="25" width="110" height="70" fill="#dcfce7" stroke="#86efac" strokeWidth="1.5" rx="3" />
            <text x="75" y="55" fill="#15803d" fontSize="10" fontWeight="600" textAnchor="middle">
              {parsedZones[0]?.period1 || 'Farmland & Trees'}
            </text>

            {/* Main Road */}
            <path d="M 145 0 L 145 160" stroke="#94a3b8" strokeWidth="6" strokeDasharray="6,3" />
            <path d="M 145 80 L 300 80" stroke="#94a3b8" strokeWidth="4" />
            <text x="210" y="74" fill="#64748b" fontSize="9" fontWeight="600">
              Main Access Road
            </text>

            {/* Residential / Old Town */}
            <rect x="170" y="20" width="125" height="50" fill="#ffedd5" stroke="#fdba74" strokeWidth="1.5" rx="3" />
            <text x="232" y="48" fill="#c2410c" fontSize="10" fontWeight="600" textAnchor="middle">
              {parsedZones[1]?.period1 || 'Old Residential Area'}
            </text>

            {/* Industrial / Pier */}
            <rect x="40" y="115" width="80" height="35" fill="#f3e8ff" stroke="#d8b4fe" strokeWidth="1.5" rx="3" />
            <text x="80" y="136" fill="#7e22ce" fontSize="9" fontWeight="600" textAnchor="middle">
              {parsedZones[2]?.period1 || 'Old Dockyards'}
            </text>

            {/* Compass Rose */}
            <g transform="translate(290, 30)">
              <circle cx="0" cy="0" r="14" fill="#ffffff" stroke="#94a3b8" strokeWidth="1" />
              <path d="M 0 -11 L 3 0 L -3 0 Z" fill="#ef4444" />
              <path d="M 0 11 L 3 0 L -3 0 Z" fill="#64748b" />
              <text x="0" y="-13" fontSize="8" fontWeight="bold" textAnchor="middle" fill="#0f172a">N</text>
            </g>

            {/* Scale indicator */}
            <line x1="20" y1="205" x2="80" y2="205" stroke="#0f172a" strokeWidth="2" />
            <text x="50" y="215" fontSize="8" fill="#0f172a" textAnchor="middle">100 m</text>
          </svg>
        </div>

        {/* Panel B: Modern Redeveloped State */}
        <div style={{ background: '#fff', border: '1px solid #cbd5e1', borderRadius: 6, padding: 12 }}>
          <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#334155', marginBottom: 8, textAlign: 'center' }}>
            Figure 2: {visual.columns[2] || 'Present Day Redevelopment'}
          </div>
          <svg viewBox="0 0 320 220" style={{ width: '100%', height: 'auto', display: 'block' }}>
            <rect width="320" height="220" fill="#f1f5f9" rx="4" />
            {/* Coastline / River */}
            <path d="M 0 160 Q 90 140 180 170 T 320 150 L 320 220 L 0 220 Z" fill="#bae6fd" />
            <text x="160" y="195" fill="#0369a1" fontSize="11" fontWeight="600" textAnchor="middle">
              Marina & Waterfront Promenade
            </text>

            {/* Modern Housing / Mixed Use */}
            <rect x="20" y="20" width="110" height="75" fill="#e0f2fe" stroke="#7dd3fc" strokeWidth="1.5" rx="3" />
            <text x="75" y="55" fill="#0284c7" fontSize="10" fontWeight="600" textAnchor="middle">
              {parsedZones[0]?.period2 || 'Commercial & Tech Hub'}
            </text>

            {/* Dual Carriageway / Roundabout */}
            <circle cx="145" cy="80" r="14" fill="#e2e8f0" stroke="#94a3b8" strokeWidth="3" />
            <path d="M 145 0 L 145 66" stroke="#94a3b8" strokeWidth="6" />
            <path d="M 145 94 L 145 160" stroke="#94a3b8" strokeWidth="6" />
            <path d="M 159 80 L 300 80" stroke="#94a3b8" strokeWidth="5" />
            <text x="210" y="74" fill="#64748b" fontSize="9" fontWeight="600">
              Dual Carriageway
            </text>

            {/* Expanded Residential Complex */}
            <rect x="170" y="15" width="130" height="55" fill="#fed7aa" stroke="#fb923c" strokeWidth="1.5" rx="3" />
            <text x="235" y="44" fill="#c2410c" fontSize="10" fontWeight="600" textAnchor="middle">
              {parsedZones[1]?.period2 || 'Modern Apartments'}
            </text>

            {/* Leisure Center / Marina Park */}
            <rect x="35" y="110" width="90" height="40" fill="#dcfce7" stroke="#86efac" strokeWidth="1.5" rx="3" />
            <text x="80" y="132" fill="#15803d" fontSize="9" fontWeight="600" textAnchor="middle">
              {parsedZones[2]?.period2 || 'Pedestrian Esplanade'}
            </text>

            {/* Compass Rose */}
            <g transform="translate(290, 30)">
              <circle cx="0" cy="0" r="14" fill="#ffffff" stroke="#94a3b8" strokeWidth="1" />
              <path d="M 0 -11 L 3 0 L -3 0 Z" fill="#ef4444" />
              <path d="M 0 11 L 3 0 L -3 0 Z" fill="#64748b" />
              <text x="0" y="-13" fontSize="8" fontWeight="bold" textAnchor="middle" fill="#0f172a">N</text>
            </g>

            {/* Scale indicator */}
            <line x1="20" y1="205" x2="80" y2="205" stroke="#0f172a" strokeWidth="2" />
            <text x="50" y="215" fontSize="8" fill="#0f172a" textAnchor="middle">100 m</text>
          </svg>
        </div>
      </div>

      {/* Zone Key / Legend Table */}
      <div style={{ marginTop: 12, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
          <thead>
            <tr style={{ background: '#e2e8f0', color: '#1e293b' }}>
              {visual.columns.map((col, idx) => (
                <th key={idx} style={{ padding: '6px 10px', textAlign: 'left', border: '1px solid #cbd5e1' }}>
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visual.rows.map((row, rIdx) => (
              <tr key={rIdx} style={{ background: rIdx % 2 === 0 ? '#fff' : '#f8fafc' }}>
                {row.map((cell, cIdx) => (
                  <td key={cIdx} style={{ padding: '6px 10px', border: '1px solid #e2e8f0' }}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}

/**
 * High-fidelity SVG / CSS Vector Bar Chart with LaTeX-styled axes and mathematical precision.
 */
function BarChartVectorRenderer({ visual, className }: VisualRendererProps) {
  const { seriesNames, categories, seriesData, maxVal } = useMemo(() => {
    const categories = visual.rows.map((r) => r[0] || '');
    const seriesNames = visual.columns.slice(1);
    const seriesData: number[][] = seriesNames.map((_, sIdx) => {
      return visual.rows.map((r) => {
        const val = parseFloat(r[sIdx + 1] ?? '0');
        return isNaN(val) ? 0 : val;
      });
    });

    let maxVal = 0;
    seriesData.forEach((s) => {
      s.forEach((v) => {
        if (v > maxVal) maxVal = v;
      });
    });
    maxVal = maxVal > 0 ? Math.ceil(maxVal * 1.15) : 100;

    return { seriesNames, categories, seriesData, maxVal };
  }, [visual]);

  const COLORS = ['#2563eb', '#059669', '#d97706', '#dc2626', '#7c3aed'];
  const chartHeight = 220;
  const chartWidth = 520;
  const paddingLeft = 55;
  const paddingBottom = 40;
  const innerWidth = chartWidth - paddingLeft - 20;
  const innerHeight = chartHeight - paddingBottom - 20;

  return (
    <figure
      style={{
        margin: '16px 0',
        padding: 16,
        background: '#ffffff',
        borderRadius: 8,
        border: '1px solid #cbd5e1',
        boxSizing: 'border-box',
      }}
      className={className}
    >
      <figcaption style={{ fontWeight: 700, fontSize: '1rem', color: '#0f172a', marginBottom: 12 }}>
        {visual.caption}
      </figcaption>

      {/* Vector Bar Chart SVG */}
      <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
        {/* Background Grid Lines & Y-Axis Labels */}
        {[0, 0.25, 0.5, 0.75, 1].map((pct, i) => {
          const y = 20 + innerHeight * (1 - pct);
          const val = Math.round(maxVal * pct);
          return (
            <g key={i}>
              <line x1={paddingLeft} y1={y} x2={chartWidth - 20} y2={y} stroke="#e2e8f0" strokeWidth="1" strokeDasharray="3,3" />
              <text x={paddingLeft - 8} y={y + 3} fontSize="10" fill="#64748b" textAnchor="end" fontFamily="KaTeX_Main, 'Times New Roman', serif">
                {val}
              </text>
            </g>
          );
        })}

        {/* X and Y Axes */}
        <line x1={paddingLeft} y1={20} x2={paddingLeft} y2={20 + innerHeight} stroke="#475569" strokeWidth="1.5" />
        <line x1={paddingLeft} y1={20 + innerHeight} x2={chartWidth - 20} y2={20 + innerHeight} stroke="#475569" strokeWidth="1.5" />

        {/* Bars */}
        {categories.map((cat, cIdx) => {
          const groupWidth = innerWidth / categories.length;
          const barWidth = Math.max(8, (groupWidth * 0.7) / seriesNames.length);
          const groupStartX = paddingLeft + cIdx * groupWidth + groupWidth * 0.15;

          return (
            <g key={cIdx}>
              {seriesNames.map((_, sIdx) => {
                const val = seriesData[sIdx]?.[cIdx] ?? 0;
                const barHeight = (val / maxVal) * innerHeight;
                const x = groupStartX + sIdx * barWidth;
                const y = 20 + innerHeight - barHeight;
                const color = COLORS[sIdx % COLORS.length] || '#2563eb';

                return (
                  <rect
                    key={sIdx}
                    x={x}
                    y={y}
                    width={barWidth - 2}
                    height={Math.max(1, barHeight)}
                    fill={color}
                    rx="1"
                  >
                    <title>{`${cat} (${seriesNames[sIdx]}): ${val}`}</title>
                  </rect>
                );
              })}
              {/* Category label */}
              <text
                x={groupStartX + (seriesNames.length * barWidth) / 2}
                y={20 + innerHeight + 16}
                fontSize="10"
                fill="#334155"
                fontWeight="500"
                textAnchor="middle"
              >
                {cat.length > 14 ? `${cat.slice(0, 13)}…` : cat}
              </text>
            </g>
          );
        })}
      </svg>

      {/* Series Legend */}
      <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginTop: 12, flexWrap: 'wrap' }}>
        {seriesNames.map((name, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem' }}>
            <span
              style={{
                width: 12,
                height: 12,
                backgroundColor: COLORS[i % COLORS.length] || '#2563eb',
                borderRadius: 2,
                display: 'inline-block',
              }}
            />
            <span style={{ color: '#334155', fontWeight: 500 }}>{name}</span>
          </div>
        ))}
      </div>
    </figure>
  );
}

/**
 * High-fidelity SVG / CSS Vector Line Graph with multi-series data points.
 */
function LineGraphVectorRenderer({ visual, className }: VisualRendererProps) {
  const { seriesNames, categories, seriesData, maxVal } = useMemo(() => {
    const categories = visual.rows.map((r) => r[0] || '');
    const seriesNames = visual.columns.slice(1);
    const seriesData: number[][] = seriesNames.map((_, sIdx) => {
      return visual.rows.map((r) => {
        const val = parseFloat(r[sIdx + 1] ?? '0');
        return isNaN(val) ? 0 : val;
      });
    });

    let maxVal = 0;
    seriesData.forEach((s) => {
      s.forEach((v) => {
        if (v > maxVal) maxVal = v;
      });
    });
    maxVal = maxVal > 0 ? Math.ceil(maxVal * 1.15) : 100;

    return { seriesNames, categories, seriesData, maxVal };
  }, [visual]);

  const COLORS = ['#2563eb', '#16a34a', '#dc2626', '#9333ea', '#ea580c'];
  const chartHeight = 220;
  const chartWidth = 520;
  const paddingLeft = 55;
  const paddingBottom = 40;
  const innerWidth = chartWidth - paddingLeft - 20;
  const innerHeight = chartHeight - paddingBottom - 20;

  return (
    <figure
      style={{
        margin: '16px 0',
        padding: 16,
        background: '#ffffff',
        borderRadius: 8,
        border: '1px solid #cbd5e1',
        boxSizing: 'border-box',
      }}
      className={className}
    >
      <figcaption style={{ fontWeight: 700, fontSize: '1rem', color: '#0f172a', marginBottom: 12 }}>
        {visual.caption}
      </figcaption>

      <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
        {/* Horizontal Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((pct, i) => {
          const y = 20 + innerHeight * (1 - pct);
          const val = Math.round(maxVal * pct);
          return (
            <g key={i}>
              <line x1={paddingLeft} y1={y} x2={chartWidth - 20} y2={y} stroke="#e2e8f0" strokeWidth="1" strokeDasharray="3,3" />
              <text x={paddingLeft - 8} y={y + 3} fontSize="10" fill="#64748b" textAnchor="end" fontFamily="KaTeX_Main, serif">
                {val}
              </text>
            </g>
          );
        })}

        {/* Axes */}
        <line x1={paddingLeft} y1={20} x2={paddingLeft} y2={20 + innerHeight} stroke="#475569" strokeWidth="1.5" />
        <line x1={paddingLeft} y1={20 + innerHeight} x2={chartWidth - 20} y2={20 + innerHeight} stroke="#475569" strokeWidth="1.5" />

        {/* X Category Tick marks */}
        {categories.map((cat, i) => {
          const x = paddingLeft + (i / Math.max(1, categories.length - 1)) * innerWidth;
          return (
            <g key={i}>
              <line x1={x} y1={20 + innerHeight} x2={x} y2={20 + innerHeight + 4} stroke="#475569" strokeWidth="1" />
              <text x={x} y={20 + innerHeight + 16} fontSize="10" fill="#334155" textAnchor="middle">
                {cat}
              </text>
            </g>
          );
        })}

        {/* Lines and Data Points */}
        {seriesNames.map((_, sIdx) => {
          const data = seriesData[sIdx] || [];
          const color = COLORS[sIdx % COLORS.length] || '#2563eb';
          const points = data.map((val, i) => {
            const x = paddingLeft + (i / Math.max(1, categories.length - 1)) * innerWidth;
            const y = 20 + innerHeight - (val / maxVal) * innerHeight;
            return { x, y, val };
          });
          const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

          return (
            <g key={sIdx}>
              <path d={pathD} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              {points.map((p, pIdx) => (
                <circle key={pIdx} cx={p.x} cy={p.y} r="4" fill="#ffffff" stroke={color} strokeWidth="2">
                  <title>{`${categories[pIdx]}: ${p.val}`}</title>
                </circle>
              ))}
            </g>
          );
        })}
      </svg>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginTop: 12, flexWrap: 'wrap' }}>
        {seriesNames.map((name, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem' }}>
            <span
              style={{
                width: 12,
                height: 3,
                backgroundColor: COLORS[i % COLORS.length] || '#2563eb',
                display: 'inline-block',
              }}
            />
            <span style={{ color: '#334155', fontWeight: 500 }}>{name}</span>
          </div>
        ))}
      </div>
    </figure>
  );
}

/**
 * Process Flow Diagram Renderer.
 */
function ProcessVectorRenderer({ visual, className }: VisualRendererProps) {
  return (
    <figure
      style={{
        margin: '16px 0',
        padding: 16,
        background: '#f8fafc',
        borderRadius: 8,
        border: '1px solid #cbd5e1',
      }}
      className={className}
    >
      <figcaption style={{ fontWeight: 700, fontSize: '1rem', color: '#0f172a', marginBottom: 12 }}>
        {visual.caption}
      </figcaption>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {visual.rows.map((row, idx) => (
          <div
            key={idx}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              background: '#fff',
              border: '1px solid #e2e8f0',
              borderRadius: 6,
              padding: '10px 14px',
            }}
          >
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: '50%',
                background: '#2563eb',
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 700,
                fontSize: '0.85rem',
                flexShrink: 0,
              }}
            >
              {idx + 1}
            </div>
            <div style={{ flex: 1 }}>
              <strong style={{ color: '#1e293b', display: 'block', fontSize: '0.9rem' }}>{row[0]}</strong>
              <span style={{ color: '#475569', fontSize: '0.85rem' }}>{row[1]}</span>
            </div>
          </div>
        ))}
      </div>
    </figure>
  );
}

/**
 * Clean Academic Data Table.
 */
function TableVectorRenderer({ visual, className }: VisualRendererProps) {
  return (
    <figure
      style={{
        margin: '16px 0',
        padding: 16,
        background: '#ffffff',
        borderRadius: 8,
        border: '1px solid #cbd5e1',
        overflowX: 'auto',
      }}
      className={className}
    >
      <figcaption style={{ fontWeight: 700, fontSize: '1rem', color: '#0f172a', marginBottom: 12 }}>
        {visual.caption}
      </figcaption>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
        <thead>
          <tr style={{ background: '#f1f5f9', borderBottom: '2px solid #cbd5e1' }}>
            {visual.columns.map((c, idx) => (
              <th key={idx} style={{ padding: '8px 12px', textAlign: idx === 0 ? 'left' : 'right', fontWeight: 600, color: '#1e293b' }}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visual.rows.map((row, rIdx) => (
            <tr key={rIdx} style={{ borderBottom: '1px solid #e2e8f0', background: rIdx % 2 === 0 ? '#fff' : '#f8fafc' }}>
              {row.map((cell, cIdx) => (
                <td key={cIdx} style={{ padding: '8px 12px', textAlign: cIdx === 0 ? 'left' : 'right', color: '#334155' }}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

export interface MapPlacedAnswer {
  questionId: string;
  questionNumber: number;
  stem: string;
  placeName?: string;
}

export interface MapQuestionItem {
  id: string;
  number: number;
  stem: string;
  placeName?: string;
  isMarked?: boolean;
}


/**
 * Authentic Interactive Drag & Drop Vector Map & Plan Labelling Component
 * for IELTS Listening Part 2 and Reading.
 * Allows candidates to drag answer chips directly onto the map pins (A through H),
 * or click-to-place for accessible keyboard and mobile support.
 */
export function MapPlanLabellingRenderer({
  title = 'Plan / Map Labelling',
  pins = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'],
  placedAnswers = {},
  questions = [],
  onDropAnswer,
  onClearPin,
  selectedQuestionId,
  onSelectQuestion,
  onToggleMark,
  className = '',
}: {
  title?: string;
  pins?: string[];
  placedAnswers?: Record<string, MapPlacedAnswer>;
  questions?: MapQuestionItem[];
  onDropAnswer?: (pin: string, questionId: string) => void;
  onClearPin?: (pin: string) => void;
  selectedQuestionId?: string | null;
  onSelectQuestion?: (questionId: string | null) => void;
  onToggleMark?: (questionId: string) => void;
  className?: string;
}) {
  const [hoveredDropPin, setHoveredDropPin] = useState<string | null>(null);

  const PIN_COORDINATES: Record<string, { x: number; y: number; label: string }> = {
    A: { x: 105, y: 75, label: 'North-West Bridge' },
    B: { x: 300, y: 60, label: 'North Lakeside Pavilion' },
    C: { x: 495, y: 80, label: 'North-East Lawn' },
    D: { x: 100, y: 195, label: 'West Courtyard' },
    E: { x: 300, y: 180, label: 'Central Information Foyer' },
    F: { x: 500, y: 190, label: 'East Exhibition Gallery' },
    G: { x: 120, y: 295, label: 'South-West Cafe' },
    H: { x: 470, y: 295, label: 'South-East Car Park' },
  };

  const activeQuestion = questions.find((q) => q.id === selectedQuestionId);

  return (
    <figure
      style={{
        margin: '16px 0',
        padding: 16,
        background: '#f8fafc',
        borderRadius: 8,
        border: '1px solid #cbd5e1',
        boxSizing: 'border-box',
      }}
      className={className}
    >
      <figcaption
        style={{
          fontWeight: 700,
          fontSize: '0.95rem',
          color: '#0f172a',
          marginBottom: 12,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 8,
        }}
      >
        <span>📍 {title}</span>
        <span
          style={{
            fontSize: '0.75rem',
            padding: '2px 8px',
            background: '#e0f2fe',
            borderRadius: 4,
            color: '#0369a1',
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
          }}
        >
          Drag &amp; Drop Map
        </span>
      </figcaption>

      {/* Draggable Answers Tray (if questions provided) */}
      {questions.length > 0 && (
        <div
          style={{
            backgroundColor: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: 8,
            padding: '12px 14px',
            marginBottom: 14,
          }}
        >
          <div
            style={{
              fontSize: '12px',
              fontWeight: 600,
              color: '#475569',
              marginBottom: 8,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span>
              🎯 Drag an item onto a letter pin on the map, or click an item then click a pin:
            </span>
            {activeQuestion && (
              <span style={{ color: '#2563eb', fontWeight: 700 }}>
                Selected: Q{activeQuestion.number} (Click any pin to drop)
              </span>
            )}
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {questions.map((q) => {
              const placedPin = Object.entries(placedAnswers).find(([_, ans]) => ans.questionId === q.id)?.[0];
              const isSelected = selectedQuestionId === q.id;
              const placeName = q.placeName || extractPlaceName(q.stem);

              return (
                <div
                  key={q.id}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/plain', q.id);
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  onClick={() => {
                    onSelectQuestion?.(isSelected ? null : q.id);
                  }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelectQuestion?.(isSelected ? null : q.id);
                    }
                  }}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 12px',
                    borderRadius: 8,
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: 'grab',
                    backgroundColor: isSelected ? '#1e3a8a' : placedPin ? '#eff6ff' : '#f8fafc',
                    color: isSelected ? '#ffffff' : placedPin ? '#1d4ed8' : '#1e293b',
                    border: isSelected
                      ? '2px solid #1e3a8a'
                      : q.isMarked
                        ? '2px solid #f59e0b'
                        : placedPin
                          ? '1px solid #93c5fd'
                          : '1px solid #cbd5e1',
                    boxShadow: isSelected ? '0 0 0 3px rgba(37,99,235,0.25)' : 'none',
                    userSelect: 'none',
                    transition: 'all 0.15s ease',
                  }}
                  title={`Place: ${placeName} (Question ${q.number}). Drag onto a map pin or click to select.`}
                >
                  <span style={{ opacity: 0.5, cursor: 'grab' }}>⋮⋮</span>
                  <span><strong>{q.number}.</strong> {placeName}</span>
                  {placedPin ? (
                    <span
                      style={{
                        marginLeft: 2,
                        padding: '2px 7px',
                        borderRadius: 4,
                        fontSize: '11px',
                        backgroundColor: '#2563eb',
                        color: '#ffffff',
                        fontWeight: 700,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        onClearPin?.(placedPin);
                      }}
                      title={`Assigned to Pin ${placedPin}. Click to unassign.`}
                    >
                      Pin {placedPin} <span style={{ opacity: 0.8, fontSize: '10px' }}>✕</span>
                    </span>
                  ) : null}
                  {onToggleMark && (
                    <button
                      type="button"
                      aria-label={`${q.isMarked ? 'Unmark' : 'Mark'} question ${q.number}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleMark(q.id);
                      }}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                        padding: '1px 3px',
                        borderRadius: '3px',
                        color: q.isMarked ? '#f59e0b' : '#94a3b8',
                        fontSize: '12px',
                        lineHeight: 1,
                      }}
                      title={q.isMarked ? 'Marked for review' : 'Mark for review'}
                    >
                      {q.isMarked ? '⚑' : '⚐'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* SVG Map Layout */}
      <svg
        viewBox="0 0 600 370"
        style={{
          width: '100%',
          height: 'auto',
          display: 'block',
          background: '#ffffff',
          borderRadius: 6,
          border: '1px solid #e2e8f0',
        }}
        role="img"
        aria-label="Map and layout diagram with marked locations A through H"
      >
        {/* Background / Grounds */}
        <rect width="600" height="370" fill="#f8fafc" />

        {/* North Waterway / Lake */}
        <path
          d="M 0 100 Q 150 40 300 50 T 600 45 L 600 0 L 0 0 Z"
          fill="#e0f2fe"
          stroke="#bae6fd"
          strokeWidth="1.5"
        />
        <text x="300" y="28" fill="#0369a1" fontSize="11" fontWeight="600" textAnchor="middle">
          North Lake &amp; Wetlands
        </text>

        {/* West Garden / Green Lawn */}
        <rect x="25" y="130" width="150" height="130" fill="#f0fdf4" stroke="#bbf7d0" strokeWidth="1.5" rx="6" />
        <text x="100" y="150" fill="#15803d" fontSize="10" fontWeight="600" textAnchor="middle">
          West Courtyard Garden
        </text>

        {/* East Exhibition Wing */}
        <rect x="425" y="130" width="150" height="130" fill="#fef3c7" stroke="#fde68a" strokeWidth="1.5" rx="6" />
        <text x="500" y="150" fill="#92400e" fontSize="10" fontWeight="600" textAnchor="middle">
          East Wing &amp; Galleries
        </text>

        {/* Main Building / Central Foyer Complex */}
        <rect x="210" y="110" width="180" height="150" fill="#ffffff" stroke="#94a3b8" strokeWidth="2" rx="4" />
        <text x="300" y="135" fill="#1e293b" fontSize="11" fontWeight="700" textAnchor="middle">
          Main Complex
        </text>

        {/* Internal Corridor & Pathways */}
        {/* Main Central Path from Entrance to North */}
        <path d="M 300 370 L 300 260" stroke="#cbd5e1" strokeWidth="18" />
        <path d="M 300 370 L 300 260" stroke="#94a3b8" strokeWidth="2" strokeDasharray="4,4" />

        {/* West-East Connecting Walkway */}
        <path d="M 175 195 L 425 195" stroke="#cbd5e1" strokeWidth="14" />
        <path d="M 175 195 L 425 195" stroke="#94a3b8" strokeWidth="1.5" strokeDasharray="4,4" />

        {/* Footpaths to peripheral areas */}
        <path d="M 100 260 L 100 320 L 210 320" stroke="#e2e8f0" strokeWidth="8" />
        <path d="M 500 260 L 500 320 L 390 320" stroke="#e2e8f0" strokeWidth="8" />

        {/* Entrance Indicator at Bottom */}
        <g transform="translate(300, 345)">
          <rect x="-95" y="-14" width="190" height="28" fill="#1e293b" rx="14" />
          <text x="0" y="4" fill="#ffffff" fontSize="11" fontWeight="700" textAnchor="middle">
            📍 YOU ARE HERE (Entrance)
          </text>
        </g>

        {/* Compass Rose in Top-Right */}
        <g transform="translate(555, 45)">
          <circle cx="0" cy="0" r="18" fill="#ffffff" stroke="#94a3b8" strokeWidth="1" />
          {/* North needle */}
          <path d="M 0 -15 L 4 0 L -4 0 Z" fill="#ef4444" />
          {/* South needle */}
          <path d="M 0 15 L 4 0 L -4 0 Z" fill="#64748b" />
          {/* East needle */}
          <path d="M 15 0 L 0 4 L 0 -4 Z" fill="#64748b" />
          {/* West needle */}
          <path d="M -15 0 L 0 4 L 0 -4 Z" fill="#64748b" />
          <text x="0" y="-17" fontSize="9" fontWeight="bold" textAnchor="middle" fill="#0f172a">N</text>
          <text x="0" y="24" fontSize="8" fontWeight="bold" textAnchor="middle" fill="#64748b">S</text>
          <text x="24" y="3" fontSize="8" fontWeight="bold" textAnchor="middle" fill="#64748b">E</text>
          <text x="-24" y="3" fontSize="8" fontWeight="bold" textAnchor="middle" fill="#64748b">W</text>
        </g>

        {/* Scale indicator in bottom-left */}
        <g transform="translate(30, 345)">
          <line x1="0" y1="0" x2="60" y2="0" stroke="#475569" strokeWidth="2" />
          <line x1="0" y1="-4" x2="0" y2="4" stroke="#475569" strokeWidth="2" />
          <line x1="60" y1="-4" x2="60" y2="4" stroke="#475569" strokeWidth="2" />
          <text x="30" y="12" fontSize="9" fill="#475569" textAnchor="middle" fontWeight="500">50 m</text>
        </g>

        {/* Render Letter Pins A through H (Interactive Drop Targets) */}
        {pins.map((pin) => {
          const coord = PIN_COORDINATES[pin];
          if (!coord) return null;
          const placed = placedAnswers[pin];
          const isHovered = hoveredDropPin === pin;
          const isSelected = selectedQuestionId && placed?.questionId === selectedQuestionId;

          return (
            <g
              key={pin}
              transform={`translate(${coord.x}, ${coord.y})`}
              style={{ cursor: 'pointer' }}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                setHoveredDropPin(pin);
              }}
              onDragLeave={() => {
                setHoveredDropPin((prev) => (prev === pin ? null : prev));
              }}
              onDrop={(e) => {
                e.preventDefault();
                setHoveredDropPin(null);
                const qId = e.dataTransfer.getData('text/plain');
                if (qId) {
                  onDropAnswer?.(pin, qId);
                }
              }}
              onClick={() => {
                if (selectedQuestionId) {
                  onDropAnswer?.(pin, selectedQuestionId);
                  onSelectQuestion?.(null);
                } else if (placed) {
                  onClearPin?.(pin);
                }
              }}
              role="button"
              tabIndex={0}
              aria-label={`Location pin ${pin}: ${coord.label}${placed ? `, placed answer: Q${placed.questionNumber} ${placed.stem}` : ', empty drop zone'}`}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  if (selectedQuestionId) {
                    onDropAnswer?.(pin, selectedQuestionId);
                    onSelectQuestion?.(null);
                  } else if (placed) {
                    onClearPin?.(pin);
                  }
                }
              }}
            >
              {/* Outer Dragover / Selection Pulse Ring */}
              {(isHovered || isSelected) && (
                <circle
                  cx="0"
                  cy="0"
                  r="24"
                  fill="none"
                  stroke="#2563eb"
                  strokeWidth="3"
                  strokeDasharray="4,3"
                  opacity="0.8"
                />
              )}

              {/* Pin Base Circle */}
              <circle
                cx="0"
                cy="0"
                r={placed ? '16' : '14'}
                fill={placed ? '#2563eb' : isHovered ? '#dbeafe' : '#ffffff'}
                stroke={placed ? '#1e40af' : isHovered ? '#2563eb' : '#2563eb'}
                strokeWidth="2.5"
                filter="drop-shadow(0px 2px 4px rgba(0,0,0,0.15))"
              />

              {/* Letter */}
              <text
                x="0"
                y="5"
                fill={placed ? '#ffffff' : '#1e3a8a'}
                fontSize="13"
                fontWeight="800"
                textAnchor="middle"
                fontFamily="system-ui, -apple-system, sans-serif"
                pointerEvents="none"
              >
                {pin}
              </text>

              {/* Placed Answer Badge (Above the pin) - Shows name of the place only */}
              {placed && (
                <g transform="translate(0, -25)">
                  {(() => {
                    const placeName = placed.placeName || extractPlaceName(placed.stem);
                    const badgeWidth = Math.max(76, Math.min(180, placeName.length * 7.5 + 24));
                    return (
                      <>
                        <rect
                          x={-badgeWidth / 2}
                          y="-11"
                          width={badgeWidth}
                          height="22"
                          rx="5"
                          fill="#0f172a"
                          stroke="#38bdf8"
                          strokeWidth="1.5"
                          filter="drop-shadow(0px 3px 5px rgba(0,0,0,0.3))"
                        />
                        <text
                          x="0"
                          y="3.5"
                          fill="#ffffff"
                          fontSize="10"
                          fontWeight="700"
                          textAnchor="middle"
                          pointerEvents="none"
                        >
                          {placeName}
                        </text>
                      </>
                    );
                  })()}
                </g>
              )}
            </g>
          );
        })}
      </svg>

      <div
        style={{
          marginTop: 10,
          fontSize: '0.8rem',
          color: '#64748b',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 6,
        }}
      >
        <span>💡 <strong>Tip:</strong> Drag any answer chip onto a map pin, or click an answer then click a pin to drop it. Click any placed pin to clear.</span>
        <span style={{ fontStyle: 'italic' }}>Orient using Entrance (bottom) and Compass Rose.</span>
      </div>
    </figure>
  );
}
