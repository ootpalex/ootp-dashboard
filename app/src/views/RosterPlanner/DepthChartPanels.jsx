// 26-Man + 40-Man Inactive depth chart droppable panels.
// Memo'd so they only re-render when projection/depth data actually change.
import { memo } from "react";
import { DroppablePanel, CoverageStrip, SlotGroup } from "./Panels.jsx";
import { BUCKET_CONFIG } from "./_shared.js";

export const ActiveDepthPanel = memo(function ActiveDepthPanel({
  depth, onSelectPlayer, hoveredPos, setHoveredPos,
}) {
  const cov = depth.coverage;
  return (
    <DroppablePanel
      bucketId="active"
      title={`Active 26-Man (${depth.counts.active}/26)`}
      subtitle={`${cov.hitterCount} hitters · ${cov.pitcherCount} pitchers (${cov.spCount} SP / ${cov.rpCount} RP)`}
      accent={BUCKET_CONFIG.active.color}
    >
      <CoverageStrip
        coverage={cov.coverage}
        coveragePotential={cov.coveragePotential}
        onHover={setHoveredPos}
        hoveredPos={hoveredPos}
      />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, padding: 8 }}>
        <div>
          <SlotGroup title="Catchers" players={depth.activeSlots.C} onSelect={onSelectPlayer} need={2}
            highlightUids={hoveredPos ? cov.coverageUids[hoveredPos] : null}
            highlightUidsPotential={hoveredPos ? cov.coverageUidsPotential?.[hoveredPos] : null}
            />
          <SlotGroup title="Infield" players={depth.activeSlots.IF} onSelect={onSelectPlayer}
            highlightUids={hoveredPos ? cov.coverageUids[hoveredPos] : null}
            highlightUidsPotential={hoveredPos ? cov.coverageUidsPotential?.[hoveredPos] : null}
            />
          <SlotGroup title="Outfield" players={depth.activeSlots.OF} onSelect={onSelectPlayer}
            highlightUids={hoveredPos ? cov.coverageUids[hoveredPos] : null}
            highlightUidsPotential={hoveredPos ? cov.coverageUidsPotential?.[hoveredPos] : null}
            />
          <SlotGroup title="Designated Hitter" players={depth.activeSlots.DH} onSelect={onSelectPlayer}
            highlightUids={hoveredPos ? cov.coverageUids[hoveredPos] : null}
            highlightUidsPotential={hoveredPos ? cov.coverageUidsPotential?.[hoveredPos] : null}
            />
        </div>
        <div>
          <SlotGroup title="Starting Rotation" players={depth.activeSlots.SP} onSelect={onSelectPlayer} target={5} need={5}
            highlightUids={hoveredPos ? cov.coverageUids[hoveredPos] : null}
            />
          <SlotGroup title="Bullpen" players={depth.activeSlots.RP} onSelect={onSelectPlayer} target={8}
            highlightUids={hoveredPos ? cov.coverageUids[hoveredPos] : null}
            />
        </div>
      </div>
      {/* Bench replaced by Short-Term / Long-Term IL split row */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, padding: 8, paddingTop: 0 }}>
        <IlPanel
          bucketId="ilShort"
          title={`Short-Term IL (${depth.ilShort?.length || 0})`}
          subtitle="15-day · stays on 40-man"
          accent={BUCKET_CONFIG.ilShort.color}
          players={depth.ilShort || []}
          onSelect={onSelectPlayer}
         
        />
        <IlPanel
          bucketId="ilLong"
          title={`Long-Term IL (${depth.ilLong?.length || 0})`}
          subtitle="60-day · removed from 40-man"
          accent={BUCKET_CONFIG.ilLong.color}
          players={depth.ilLong || []}
          onSelect={onSelectPlayer}
         
        />
      </div>
    </DroppablePanel>
  );
});

function IlPanel({ bucketId, title, subtitle, accent, players, onSelect }) {
  return (
    <DroppablePanel bucketId={bucketId} title={title} subtitle={subtitle} accent={accent}>
      {players.length === 0 ? (
        <div style={{ padding: "8px 12px", color: "#475569", fontSize: 11, fontStyle: "italic" }}>
          Empty — drag players here.
        </div>
      ) : (
        <SlotGroup title=" " players={players} onSelect={onSelect} />
      )}
    </DroppablePanel>
  );
}

export const InactiveDepthPanel = memo(function InactiveDepthPanel({
  depth, onSelectPlayer, hoveredPos, setHoveredPos,
}) {
  const cov = depth.inactiveCoverage;
  return (
    <DroppablePanel
      bucketId="fortyMan"
      title={`40-Man Inactive Depth (${depth.counts.inactive40}/14)`}
      subtitle="Tiles show backup coverage: C/SS/CF ≥1, SP ≥2, RP ≥2 additional pitchers"
      accent={BUCKET_CONFIG.fortyMan.color}
    >
      <CoverageStrip
        coverage={cov.coverage}
        coveragePotential={cov.coveragePotential}
        onHover={setHoveredPos}
        hoveredPos={hoveredPos}
        requirements={cov.requirements}
        ideals={{ C: null, SS: null, CF: null, SP: null, RP: null }}
      />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, padding: 8 }}>
        <div>
          <SlotGroup title="Catchers" players={depth.inactiveSlots.C} onSelect={onSelectPlayer}
            highlightUids={hoveredPos ? cov.coverageUids[hoveredPos] : null}
            highlightUidsPotential={hoveredPos ? cov.coverageUidsPotential?.[hoveredPos] : null} />
          <SlotGroup title="Infield" players={depth.inactiveSlots.IF} onSelect={onSelectPlayer}
            highlightUids={hoveredPos ? cov.coverageUids[hoveredPos] : null}
            highlightUidsPotential={hoveredPos ? cov.coverageUidsPotential?.[hoveredPos] : null} />
          <SlotGroup title="Outfield" players={depth.inactiveSlots.OF} onSelect={onSelectPlayer}
            highlightUids={hoveredPos ? cov.coverageUids[hoveredPos] : null}
            highlightUidsPotential={hoveredPos ? cov.coverageUidsPotential?.[hoveredPos] : null} />
          {depth.inactiveSlots.DH.length > 0 && (
            <SlotGroup title="Designated Hitter" players={depth.inactiveSlots.DH} onSelect={onSelectPlayer}
              highlightUids={hoveredPos ? cov.coverageUids[hoveredPos] : null}
              highlightUidsPotential={hoveredPos ? cov.coverageUidsPotential?.[hoveredPos] : null} />
          )}
          {depth.inactiveSlots.bench.length > 0 && (
            <SlotGroup title="Other Hitters" players={depth.inactiveSlots.bench} onSelect={onSelectPlayer}
              highlightUids={hoveredPos ? cov.coverageUids[hoveredPos] : null}
              highlightUidsPotential={hoveredPos ? cov.coverageUidsPotential?.[hoveredPos] : null} />
          )}
        </div>
        <div>
          <SlotGroup title="SP Depth" players={depth.inactiveSlots.SP} onSelect={onSelectPlayer} need={2}
            highlightUids={hoveredPos ? cov.coverageUids[hoveredPos] : null} />
          <SlotGroup title="RP Depth" players={depth.inactiveSlots.RP} onSelect={onSelectPlayer} need={2}
            highlightUids={hoveredPos ? cov.coverageUids[hoveredPos] : null} />
        </div>
      </div>
    </DroppablePanel>
  );
});
