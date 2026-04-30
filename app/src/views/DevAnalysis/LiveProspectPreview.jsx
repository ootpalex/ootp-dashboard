// Live prospect preview — sort/limit owned locally so changes don't churn the parent.
import { memo, useCallback, useMemo, useState } from "react";
import { S, waaStyle, devPctColor } from "../../theme.js";
import { Section, SortHeader } from "../../components/shared.jsx";
import { POS_SORT_ORDER } from "../../utils/accessors.js";

export const LiveProspectPreview = memo(function LiveProspectPreview({ prospectPreview, poolLabel }) {
  const [prospectLimit, setProspectLimit] = useState(30);
  const [ppSortCol, setPpSortCol] = useState("fv");
  const [ppSortDir, setPpSortDir] = useState("desc");
  const handlePpSort = useCallback((col) => {
    setPpSortCol(col);
    setPpSortDir(prev => ppSortCol === col ? (prev === "desc" ? "asc" : "desc") : "desc");
  }, [ppSortCol]);

  const sortedProspectPreview = useMemo(() => {
    if (ppSortCol === "fv" && ppSortDir === "desc") return prospectPreview.slice(0, prospectLimit);
    const cmp = (a, b) => {
      let va = a[ppSortCol], vb = b[ppSortCol];
      if (ppSortCol === "pos") {
        va = POS_SORT_ORDER[va] ?? 99; vb = POS_SORT_ORDER[vb] ?? 99;
        return ppSortDir === "asc" ? va - vb : vb - va;
      }
      if (ppSortCol === "name" || ppSortCol === "org") {
        va = (va ?? "").toLowerCase(); vb = (vb ?? "").toLowerCase();
        return ppSortDir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
      }
      va = va ?? -Infinity; vb = vb ?? -Infinity;
      return ppSortDir === "asc" ? va - vb : vb - va;
    };
    return [...prospectPreview].sort(cmp).slice(0, prospectLimit);
  }, [prospectPreview, prospectLimit, ppSortCol, ppSortDir]);

  return (
    <Section title="Live Prospect Preview">
      <div style={{ fontSize: 11, color: "#475569", marginBottom: 8 }}>
        Real prospects ranked by FV with current slider settings. Updates as you adjust curve parameters below.
      </div>
      <div style={{ fontSize: 11, color: "#64748b", marginBottom: 8 }}>
        Top {Math.min(prospectLimit, prospectPreview.length)} of {prospectPreview.length} prospects ({poolLabel})
      </div>
      <div style={S.tableWrap}>
        <table style={S.table}>
          <thead>
            <tr>
              <th style={{ ...S.th, width: 30 }}>Rk</th>
              <SortHeader label="Name" width={160} sortCol={ppSortCol} sortDir={ppSortDir} colKey="name" onClick={() => handlePpSort("name")} />
              <SortHeader label="Age" width={42} sortCol={ppSortCol} sortDir={ppSortDir} colKey="age" onClick={() => handlePpSort("age")} />
              <SortHeader label="Pos" width={42} sortCol={ppSortCol} sortDir={ppSortDir} colKey="pos" onClick={() => handlePpSort("pos")} />
              <SortHeader label="Org" width={100} sortCol={ppSortCol} sortDir={ppSortDir} colKey="org" onClick={() => handlePpSort("org")} />
              <SortHeader label="Dev%" width={48} sortCol={ppSortCol} sortDir={ppSortDir} colKey="devPct" onClick={() => handlePpSort("devPct")} />
              <SortHeader label="Cur" width={58} sortCol={ppSortCol} sortDir={ppSortDir} colKey="cur" onClick={() => handlePpSort("cur")} />
              <SortHeader label="Pot" width={58} sortCol={ppSortCol} sortDir={ppSortDir} colKey="pot" onClick={() => handlePpSort("pot")} />
              <SortHeader label="FV" width={58} sortCol={ppSortCol} sortDir={ppSortDir} colKey="fv" onClick={() => handlePpSort("fv")} />
            </tr>
          </thead>
          <tbody>
            {sortedProspectPreview.map((p, i) => (
              <tr key={p.fvRank} style={{ background: i % 2 === 0 ? "transparent" : "rgba(15,23,42,0.3)" }}>
                <td style={{ ...S.td, color: "#475569", fontWeight: 600 }}>{p.fvRank}</td>
                <td style={{ ...S.td, color: "#e2e8f0", fontWeight: 600 }}>{p.name}</td>
                <td style={{ ...S.td, color: "#94a3b8" }}>{p.age != null ? (Number.isInteger(p.age) ? p.age : p.age.toFixed(1)) : "—"}</td>
                <td style={{ ...S.td, color: "#94a3b8" }}>{p.pos}</td>
                <td style={{ ...S.td, color: "#94a3b8" }}>{p.org}</td>
                <td style={{ ...S.td, textAlign: "center", color: devPctColor(p.devPct), fontWeight: 600 }}>{Math.round(p.devPct * 100)}th</td>
                <td style={{ ...S.td, textAlign: "center", ...waaStyle(p.cur), fontWeight: 600 }}>{p.cur != null ? p.cur.toFixed(1) : "—"}</td>
                <td style={{ ...S.td, textAlign: "center", ...waaStyle(p.pot), fontWeight: 600 }}>{p.pot != null ? p.pot.toFixed(1) : "—"}</td>
                <td style={{ ...S.td, textAlign: "center", ...waaStyle(p.fv), fontWeight: 700 }}>{p.fv != null ? p.fv.toFixed(2) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {prospectPreview.length > 30 && (
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          {[30, 50, 100].map(n => (
            <button key={n} onClick={() => setProspectLimit(n)}
              style={{ ...S.pillBtn, borderColor: prospectLimit === n ? "#3b82f6" : "#334155", color: prospectLimit === n ? "#93c5fd" : "#64748b", padding: "3px 10px", fontSize: 11 }}>
              Top {n}
            </button>
          ))}
        </div>
      )}
    </Section>
  );
});
