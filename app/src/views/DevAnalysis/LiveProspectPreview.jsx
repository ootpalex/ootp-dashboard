// Live prospect preview — sort/limit owned locally so changes don't churn the parent.
import { memo, useCallback, useMemo, useState } from "react";
import { TOKENS as T, S, warStyle, devPctStyle, posColor } from "../../theme.js";
import { Section, SortHeader, PillBtn, TabGroup, colRule } from "../../components/shared.jsx";
import { POS_SORT_ORDER } from "../../utils/accessors.js";
import { rankSuffix } from "../../utils/helpers.js";

// Scorecard column grammar: Rk Name Age Pos Org | Dev% | Cur Pot FV (two group rules).
const COLS = [
  { key: "fvRank", label: "Rk", w: 36, group: "identity", align: "right" },
  { key: "name", label: "Name", w: 160, group: "identity" },
  { key: "age", label: "Age", w: 42, group: "identity", align: "right" },
  { key: "pos", label: "Pos", w: 42, group: "identity" },
  { key: "org", label: "Org", w: 100, group: "identity" },
  { key: "devPct", label: "Dev%", w: 56, group: "development", align: "right" },
  { key: "cur", label: "Cur", w: 58, group: "value", align: "right" },
  { key: "pot", label: "Pot", w: 58, group: "value", align: "right" },
  { key: "fv", label: "FV", w: 58, group: "value", align: "right" },
];
const edgePad = (i, v) => (i === 0 ? { padding: `${v} 6px ${v} 12px` } : i === COLS.length - 1 ? { padding: `${v} 12px ${v} 6px` } : {});
const thRule = (i) => ({ ...(colRule(COLS, i) || {}), ...edgePad(i, "6px") });
const tdStyle = (i) => ({ ...S.td, ...(colRule(COLS, i) || {}), ...(COLS[i].align ? { textAlign: COLS[i].align } : {}), ...edgePad(i, "0") });

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
    <Section title="Live Prospect Preview"
      state={`Top ${Math.min(prospectLimit, prospectPreview.length)} of ${prospectPreview.length} prospects (${poolLabel})`}
      actions={prospectPreview.length > 30 ? (
        <TabGroup label="Preview size">
          {[30, 50, 100].map(n => (
            <PillBtn key={n} active={prospectLimit === n} onClick={() => setProspectLimit(n)} style={{ padding: "3px 10px", fontSize: 12 }}>
              Top {n}
            </PillBtn>
          ))}
        </TabGroup>
      ) : undefined}
      footer="Real prospects ranked by FV with current slider settings. Updates as you adjust the curve parameters above.">
      {/* Table runs edge to edge inside the box body (the box border is the rule). */}
      <div style={{ margin: -12 }}>
        <div style={{ ...S.tableWrap, border: "none", borderRadius: 0 }}>
          <table style={S.table}>
            <thead>
              <tr>
                <th style={{ ...S.th, ...thRule(0), width: COLS[0].w, textAlign: "right" }}>Rk</th>
                {COLS.slice(1).map(({ key, label, w, align }, j) => (
                  <SortHeader key={key} label={label} width={w} align={align} rule={thRule(j + 1)} sortCol={ppSortCol} sortDir={ppSortDir} colKey={key} onClick={() => handlePpSort(key)} />
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedProspectPreview.map((p, i) => (
                <tr key={p.fvRank} style={i % 2 === 1 ? S.zebraRow : undefined}>
                  <td style={{ ...tdStyle(0), color: T.text3, fontWeight: 600 }}>{p.fvRank}</td>
                  <td style={{ ...tdStyle(1), ...S.tdName }}>{p.name}</td>
                  <td style={{ ...tdStyle(2), color: T.text2 }}>{p.age != null ? (Number.isInteger(p.age) ? p.age : p.age.toFixed(1)) : "—"}</td>
                  <td style={{ ...tdStyle(3), fontFamily: T.fonts.narrow, fontWeight: 600, color: posColor(p.pos) }}>{p.pos}</td>
                  <td style={{ ...tdStyle(4), color: T.text2 }}>{p.org}</td>
                  <td style={{ ...tdStyle(5), ...(p.devPct != null ? devPctStyle(p.devPct) : { color: T.textDisabled }) }}>{p.devPct != null ? rankSuffix(Math.round(p.devPct * 100)) : "—"}</td>
                  <td style={{ ...tdStyle(6), ...warStyle(p.cur) }}>{p.cur != null ? p.cur.toFixed(1) : "—"}</td>
                  <td style={{ ...tdStyle(7), ...warStyle(p.pot) }}>{p.pot != null ? p.pot.toFixed(1) : "—"}</td>
                  <td style={{ ...tdStyle(8), ...warStyle(p.fv), fontWeight: 700 }}>{p.fv != null ? p.fv.toFixed(2) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Section>
  );
});
