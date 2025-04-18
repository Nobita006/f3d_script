import adsk.core, adsk.fusion, traceback, os, sys, math

# ───────────────────────────────── USER SETTINGS ──────────────────────────
EXPORT_DIR = r"C:\Users\sayan\OneDrive\Documents\Visual_Studio_2022\Freelance\f3d_script"
POLY_TOL   = 1e-4            # mm;  deviation allowed when arcs → poly‑lines
TARGETS    = ('top', 'side1', 'side2')   # names (lower‑case) to export
# ───────────────────────────────────────────────────────────────────────────

def first_planar_face(body):
    """Return any planar face (used as stationary face when creating flat pattern)."""
    for f in body.faces:
        if isinstance(f.geometry, adsk.core.Plane):
            return f
    return None


def export_flatpattern_as_dxf(comp, exp_mgr):
    """
    Ensure comp has a flat pattern, then write one DXF with closed polylines.
    File name = component name + '_flat.dxf'
    """
    flat = comp.flatPattern
    if flat is None:                                  # create if absent
        body = comp.bRepBodies.item(0)
        stat = first_planar_face(body)
        if not stat:
            return False                              # cannot flatten → skip
        flat = comp.createFlatPattern(stat)

    dxf_path = os.path.join(EXPORT_DIR, f'{comp.name}_flat.dxf')
    opts = exp_mgr.createDXFFlatPatternExportOptions(flat, dxf_path)

    # keep arcs as single bulged poly‑lines
    if hasattr(opts, 'isSplineConvertedToPolyline'):
        opts.isSplineConvertedToPolyline = True
    if hasattr(opts, 'convertToPolylineTolerance'):
        opts.convertToPolylineTolerance = POLY_TOL

    exp_mgr.execute(opts)
    return True


def run(context):
    ui = None
    try:
        app = adsk.core.Application.get()
        ui  = app.userInterface

        doc = app.activeDocument
        if not doc:
            ui.messageBox('Open a design first.') ; return
        design = adsk.fusion.Design.cast(
            doc.products.itemByProductType('DesignProductType'))
        if not design:
            ui.messageBox('Active doc is not a Fusion design.') ; return

        os.makedirs(EXPORT_DIR, exist_ok=True)
        exp_mgr = design.exportManager
        root    = design.rootComponent

        exported = []
        skipped  = []

        for occ in root.occurrences:
            lname = occ.name.lower()
            if 'mirror' in lname:                # ignore the mirrored halves
                continue
            if not any(lname.startswith(t) for t in TARGETS):
                continue

            if export_flatpattern_as_dxf(occ.component, exp_mgr):
                exported.append(occ.name)
            else:
                skipped.append(occ.name)

        msg  = f'DXF export complete.\n\nExported: {exported}'
        if skipped:
            msg += f'\nSkipped (no planar face): {skipped}'
        ui.messageBox(msg)

    except:
        if ui:
            ui.messageBox('Failed:\n' + traceback.format_exc())
        else:
            print(traceback.format_exc(), file=sys.stderr)
