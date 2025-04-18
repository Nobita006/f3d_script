import adsk.core, adsk.fusion, traceback, os, sys, json

# ───────────── configure once ─────────────
EXPORT_DIR = r"C:\Users\sayan\OneDrive\Documents\Visual_Studio_2022\Freelance\f3d_script"
DIMS_JSON  = os.path.join(EXPORT_DIR, 'dims.json')

# Default values (fallback if JSON is missing or a key is absent)
DEFAULT_DIMS = {
    'Length_Screws': 4,
    'Width_Screws' : 4,
    'Length'       : 200,  # mm
    'Width'        : 400,  # mm
    'Height'       : 100   # mm
}

TARGET_PREFIXES    = ('top', 'side1', 'side2')   # components to export
POLYLINE_TOLERANCE = 1e-4                        # mm
# ───────────────────────────────────────────

def load_dimensions():
    """Load the dims JSON if present, otherwise return DEFAULT_DIMS."""
    if os.path.exists(DIMS_JSON):
        try:
            with open(DIMS_JSON, 'r') as f:
                data = json.load(f)
            # cast and fallback to defaults
            return {
                'Length_Screws': int(data.get('Length_Screws', DEFAULT_DIMS['Length_Screws'])),
                'Width_Screws' : int(data.get('Width_Screws',  DEFAULT_DIMS['Width_Screws'])),
                'Length'       : float(data.get('Length',       DEFAULT_DIMS['Length'])),
                'Width'        : float(data.get('Width',        DEFAULT_DIMS['Width'])),
                'Height'       : float(data.get('Height',       DEFAULT_DIMS['Height']))
            }
        except Exception as e:
            adsk.core.Application.get().userInterface.messageBox(
                f"⚠️ Failed to parse dims.json: {e}\nUsing defaults."
            )
    return DEFAULT_DIMS.copy()

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

        # Load dims (from JSON or defaults)
        dims = load_dimensions()

        # 1) Open design & cast
        design = adsk.fusion.Design.cast(app.activeProduct)
        if not design:
            ui.messageBox('❌ No Fusion design active.'); return

        # 2) Update user parameters
        p = design.userParameters
        p.itemByName('Length_Screws').expression = str(dims['Length_Screws'])
        p.itemByName('Width_Screws' ).expression = str(dims['Width_Screws'])
        p.itemByName('Length'       ).expression = f"{dims['Length']} mm"
        p.itemByName('Width'        ).expression = f"{dims['Width']} mm"
        p.itemByName('Height'       ).expression = f"{dims['Height']} mm"

        # 3) Prepare export
        os.makedirs(EXPORT_DIR, exist_ok=True)
        exp_mgr = design.exportManager
        root    = design.rootComponent

        exported, skipped = [], []

        # 4) Loop occurrences
        for occ in root.occurrences:
            name = occ.name.lower()
            if 'mirror' in name or not any(name.startswith(pref) for pref in TARGET_PREFIXES):
                continue

            flat = flat_pattern_for(occ.component)
            if not flat:
                skipped.append(occ.name)
                continue

            compName = occ.component.name      # “Top”, “Side1”, “Side2”
            dxfFile  = os.path.join(EXPORT_DIR, f"{compName}_flat.dxf")
            opts = exp_mgr.createDXFFlatPatternExportOptions(dxfFile, flat)

            # closed poly‑lines & tolerance
            if hasattr(opts, 'isSplineConvertedToPolyline'):
                opts.isSplineConvertedToPolyline = True
            if hasattr(opts, 'convertToPolylineTolerance'):
                opts.convertToPolylineTolerance = POLYLINE_TOLERANCE

            exp_mgr.execute(opts)
            exported.append(compName)

        # 5) Report
        msg  = f"✅ DXF export done.\n\nExported: {exported or '-'}"
        if skipped:
            msg += f"\nSkipped (no planar faces): {skipped}"
        ui.messageBox(msg)

    except:
        if ui:
            ui.messageBox('⚠️ Failed:\n' + traceback.format_exc())
        else:
            print(traceback.format_exc(), file=sys.stderr)
