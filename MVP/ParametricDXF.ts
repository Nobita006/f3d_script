/// <reference types="@adsk/core" />
/// <reference types="@adsk/fusion" />

// -----------------------------------------------------------------------------
// ParametricDXF.ts – runs inside Forge Design Automation (Fusion 360 engine)
// -----------------------------------------------------------------------------
import * as fs from 'fs';

const TARGETS = ['top', 'side1', 'side2'];                  // prefixes to export
const TOL     = 1e-4;                                       // poly‑line tolerance

// Helper: return largest planar face of a body
function largestPlanarFace(body: adsk.fusion.BRepBody)
        : adsk.fusion.BRepFace | null {
    let best: adsk.fusion.BRepFace | null = null;
    let bestArea = 0;
    body.faces.forEach((f: adsk.fusion.BRepFace) => {
        if (f.geometry && f.geometry.classType() === adsk.core.Plane.classType()) {
            if (f.area > bestArea) { bestArea = f.area; best = f; }
        }
    });
    return best;
}

// Main entry‑point for the Fusion engine
export function run(context: any): void {
    let ui: adsk.core.UserInterface | null = null;
    try {
        const app  = adsk.core.Application.get();
        ui         = app.userInterface;
        const des  = adsk.fusion.Design.cast(app.activeProduct);

        if (!des) { throw new Error('No active Fusion design'); }

        // ‑‑ 1. Read dims.json input ----------------------------
        const dims   = JSON.parse(fs.readFileSync('dims.json', 'utf8'));
        const pVals  = {
            Length_Screws: parseFloat(dims.Length_Screws),
            Width_Screws : parseFloat(dims.Width_Screws),
            Length       : parseFloat(dims.Length),
            Width        : parseFloat(dims.Width),
            Height       : parseFloat(dims.Height)
        };

        // ‑‑ 2. Update user parameters --------------------------
        const pars = des.userParameters;
        pars.itemByName('Length_Screws').expression = String(pVals.Length_Screws);
        pars.itemByName('Width_Screws' ).expression = String(pVals.Width_Screws);
        pars.itemByName('Length'       ).expression = `${pVals.Length} mm`;
        pars.itemByName('Width'        ).expression = `${pVals.Width} mm`;
        pars.itemByName('Height'       ).expression = `${pVals.Height} mm`;

        // ‑‑ 3. Export DXFs ------------------------------------
        const expMgr = des.exportManager;
        const root   = des.rootComponent;

        root.occurrences.forEach((occ: adsk.fusion.Occurrence) => {
            const lcName = occ.name.toLowerCase();
            if (lcName.indexOf('mirror') !== -1) return;
            if (!TARGETS.some(pfx => lcName.startsWith(pfx))) return;

            const comp        = occ.component;
            let   flatPattern = comp.flatPattern;

            if (!flatPattern) {
                const body = comp.bRepBodies.item(0);
                if (!body) return;
                const face = largestPlanarFace(body);
                if (!face) return;
                flatPattern = comp.createFlatPattern(face);
            }

            const outName = comp.name.replace(/\s+/g, '') + '_flat.dxf'; // e.g. Top_flat.dxf
            const dxfOpt  = expMgr.createDXFFlatPatternExportOptions(outName, flatPattern);

            if (dxfOpt.hasOwnProperty('isSplineConvertedToPolyline'))
                (dxfOpt as any).isSplineConvertedToPolyline = true;
            if (dxfOpt.hasOwnProperty('convertToPolylineTolerance'))
                (dxfOpt as any).convertToPolylineTolerance  = TOL;

            expMgr.execute(dxfOpt);
        });

    } catch (e) {
        if (ui) ui.messageBox('Script failed: ' + (e as Error).message);
    }
}
