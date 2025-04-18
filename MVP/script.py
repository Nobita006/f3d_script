import adsk.core, adsk.fusion, traceback, os, sys

# ───────────── configure once ─────────────
EXPORT_DIR = (r"C:\Users\sayan\OneDrive\Documents\Visual_Studio_2022\Freelance"
              r"\f3d_script")

PARAM_UPDATES = {
    'Length_Screws': '4',
    'Width_Screws' : '3',
    'Length'       : '200 mm',
    'Width'        : '400 mm',
    'Height'       : '100 mm'
}

TARGET_PREFIXES    = ('top', 'side1', 'side2')   # components to export
POLYLINE_TOLERANCE = 1e-4                        # mm
# ───────────────────────────────────────────

def largest_planar_face(body):
    best, area = None, 0.0
    for f in body.faces:
        if isinstance(f.geometry, adsk.core.Plane) and f.area > area:
            best, area = f, f.area
    return best

def flat_pattern_for(comp):
    if comp.flatPattern:
        return comp.flatPattern
    if comp.bRepBodies.count == 0:
        return None
    face = largest_planar_face(comp.bRepBodies.item(0))
    return comp.createFlatPattern(face) if face else None

# ───────────────────────── main ─────────────────────────
def run(context):
    ui = None
    try:
        app    = adsk.core.Application.get()
        ui     = app.userInterface
        design = adsk.fusion.Design.cast(app.activeProduct)
        if not design:
            ui.messageBox('❌  No Fusion design active.'); return

        # 1) Update parameters
        for name, expr in PARAM_UPDATES.items():
            prm = design.userParameters.itemByName(name)
            if prm:
                prm.expression = expr

        # 2) Prepare export folder & manager
        os.makedirs(EXPORT_DIR, exist_ok=True)
        exp_mgr = design.exportManager
        root    = design.rootComponent

        exported, skipped = [], []

        # 3) Loop over occurrences
        for occ in root.occurrences:
            lname = occ.name.lower()
            if 'mirror' in lname or not any(lname.startswith(p) for p in TARGET_PREFIXES):
                continue

            flat = flat_pattern_for(occ.component)
            if not flat:
                skipped.append(occ.name)
                continue

            # ←――――――――――――――――――――――――――――――――――――――
            # Use the *component* name (no colon!) to build a valid file name:
            compName = occ.component.name       # e.g. "Top", not "Top:1"
            dxf_file = os.path.join(EXPORT_DIR, f'{compName}_flat.dxf')
            # ―――――――――――――――――――――――――――――――――――――――→

            opts = exp_mgr.createDXFFlatPatternExportOptions(dxf_file, flat)
            if hasattr(opts, 'isSplineConvertedToPolyline'):
                opts.isSplineConvertedToPolyline = True
            if hasattr(opts, 'convertToPolylineTolerance'):
                opts.convertToPolylineTolerance = POLYLINE_TOLERANCE

            exp_mgr.execute(opts)
            exported.append(compName)

        # 4) Report
        msg = f'✅  DXF export complete.\n\nExported: {exported or "-"}'
        if skipped:
            msg += f'\nSkipped (no planar faces): {skipped}'
        ui.messageBox(msg)

    except:
        if ui:
            ui.messageBox('⚠️  Failed:\n' + traceback.format_exc())
        else:
            print(traceback.format_exc(), file=sys.stderr)
