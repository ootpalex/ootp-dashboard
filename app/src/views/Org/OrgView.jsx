import { useState, useMemo } from "react";
import { parseCSVBoolean } from "../../utils/helpers.js";
import { PillBtn, TabGroup } from "../../components/shared.jsx";
import OverviewSubTab from "./OverviewSubTab.jsx";
import ActiveRosterSubTab from "./ActiveRosterSubTab.jsx";
import FortyManSubTab from "./FortyManSubTab.jsx";
import OptimizedLineupSubTab from "./OptimizedLineupSubTab.jsx";
import R5EligibleSubTab from "./R5EligibleSubTab.jsx";

export default function OrgView({ data, team, strength, curveSettings, onSelectPlayer }) {
  const [orgSubTab, setOrgSubTab] = useState("overview");

  const teamHitters = useMemo(() => data.hitters.filter((h) => (h.meta?.org ?? h.ORG) === team), [data.hitters, team]);
  const teamPitchers = useMemo(() => data.pitchers.filter((p) => (p.meta?.org ?? p.ORG) === team), [data.pitchers, team]);

  const activeRosterCount = useMemo(() => {
    const isMLBRoster = (p) => ((p.meta?.lev ?? p.Lev) === "MLB" && (p.meta?.on40 ?? (p.ON40 === "Yes"))) || ((p.meta?.lev ?? p.Lev) === "MLB" && ((p.meta?.inj != null ? p.meta.inj === "Yes" : parseCSVBoolean(p.INJ))));
    return teamHitters.filter(isMLBRoster).length + teamPitchers.filter(isMLBRoster).length;
  }, [teamHitters, teamPitchers]);

  const ORG_SUB_TABS = [
    { id: "overview", label: "Overview" },
    { id: "active", label: `Active Roster (${activeRosterCount})` },
    { id: "fortyman", label: "40-Man Depth" },
    { id: "lineup", label: "Optimized Lineup" },
    { id: "r5", label: "Rule 5 Eligible" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <TabGroup label="Organization sections" style={{ display: "flex", gap: 8, borderBottom: "1px solid #1e293b", paddingBottom: 12 }}>
        {ORG_SUB_TABS.map((tab) => (
          <PillBtn key={tab.id} active={orgSubTab === tab.id} onClick={() => setOrgSubTab(tab.id)}>
            {tab.label}
          </PillBtn>
        ))}
      </TabGroup>

      {orgSubTab === "overview" && (
        <OverviewSubTab
          data={data} team={team}
          teamHitters={teamHitters} teamPitchers={teamPitchers}
          strength={strength}
          onSelectPlayer={onSelectPlayer}
        />
      )}
      {orgSubTab === "active" && <ActiveRosterSubTab data={data} team={team} onSelectPlayer={onSelectPlayer} />}
      {orgSubTab === "fortyman" && <FortyManSubTab data={data} team={team} strength={strength} onSelectPlayer={onSelectPlayer} />}
      {orgSubTab === "lineup" && <OptimizedLineupSubTab data={data} team={team} onSelectPlayer={onSelectPlayer} />}
      {orgSubTab === "r5" && <R5EligibleSubTab teamHitters={teamHitters} teamPitchers={teamPitchers} onSelectPlayer={onSelectPlayer} />}
    </div>
  );
}
