// Small, dependency-free charts. Single hue for magnitude; values always printed as text, so colour never carries meaning alone.

export function BarList({ rows, onSelect, empty = 'No data in this period.' }) {
  if (!rows.length || rows.every((r) => !r.value)) return <div className="empty">{empty}</div>;
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="hb">
      {rows.map((r) => {
        const clickable = onSelect && r.value > 0;
        return (
          <div key={r.key} className={`hb-row ${clickable ? 'clk' : ''}`} title={`${r.label}: ${r.value}${clickable ? ' · open list' : ''}`}
            {...(clickable ? { role: 'button', tabIndex: 0, onClick: () => onSelect(r), onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(r); } } } : {})}>
            <span className="hb-l">{r.label}</span>
            <span className="hb-track"><span className="hb-bar" style={{ width: `${(r.value / max) * 100}%` }} /></span>
            <span className="hb-v">{r.value}</span>
          </div>
        );
      })}
    </div>
  );
}

export function Columns({ rows }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  const top = max <= 4 ? 4 : Math.ceil(max / 2) * 2;
  return (
    <div className="cols">
      <div className="cols-y"><span>{top}</span><span>{top / 2}</span><span>0</span></div>
      <div className="cols-plot">
        {rows.map((r) => (
          <div key={r.key} className="c" title={`${r.label}: ${r.value} request${r.value === 1 ? '' : 's'}`}>
            <i style={{ height: `${(r.value / top) * 100}%` }} />
          </div>
        ))}
      </div>
      <div className="cols-x">{rows.map((r) => <span key={r.key}>{r.short}</span>)}</div>
    </div>
  );
}
