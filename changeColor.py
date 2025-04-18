import ezdxf
import os

# ─────────────── CONFIGURATION ───────────────
SOURCE_DIR    = os.getcwd()                        # Folder with original DXFs
DEST_DIR      = os.path.join(SOURCE_DIR, 'colored')
LAYER_OUTER   = 'OUTER_LOOP'
LAYER_INNER   = 'INNER_LOOP'
# ACI color indices (AutoCAD): 1 = red, 5 = blue
COLOR_OUTER   = 1  
COLOR_INNER   = 5  
# ────────────────────────────────────────────────

def polygon_area(points):
    """Compute signed polygon area via the shoelace formula."""
    area = 0.0
    n = len(points)
    for i in range(n):
        x1, y1 = points[i]
        x2, y2 = points[(i + 1) % n]
        area += x1 * y2 - x2 * y1
    return area / 2.0

def process_file(src_path, dest_path):
    print(f"Processing '{os.path.basename(src_path)}'…")
    doc = ezdxf.readfile(src_path)
    msp = doc.modelspace()

    # Ensure colored layers exist (with desired color index)
    if LAYER_OUTER not in doc.layers:
        doc.layers.new(LAYER_OUTER, dxfattribs={'color': COLOR_OUTER})
    if LAYER_INNER not in doc.layers:
        doc.layers.new(LAYER_INNER, dxfattribs={'color': COLOR_INNER})

    # Collect all closed LWPOLYLINEs
    loops = []
    for pl in msp.query('LWPOLYLINE'):
        if pl.closed:
            pts = [tuple(pt[:2]) for pt in pl.get_points()]
            loops.append((abs(polygon_area(pts)), pl))

    if loops:
        loops.sort(key=lambda x: x[0], reverse=True)
        outer_pl = loops[0][1]
        inner_pls = [pl for _, pl in loops[1:]]
        # Assign layers
        outer_pl.dxf.layer = LAYER_OUTER
        for pl in inner_pls:
            pl.dxf.layer = LAYER_INNER
    else:
        print("  ⚠️ No LWPOLYLINE loops found.")

    # Also assign circles and arcs (hole entities) to inner layer
    for circle in msp.query('CIRCLE'):
        circle.dxf.layer = LAYER_INNER
    for arc in msp.query('ARC'):
        arc.dxf.layer = LAYER_INNER

    # Save to destination
    doc.saveas(dest_path)

def main():
    os.makedirs(DEST_DIR, exist_ok=True)
    for fname in os.listdir(SOURCE_DIR):
        if not fname.lower().endswith('.dxf'):
            continue
        src_file  = os.path.join(SOURCE_DIR, fname)
        dest_file = os.path.join(DEST_DIR, fname)
        try:
            process_file(src_file, dest_file)
        except Exception as e:
            print(f"  ⚠️ Error processing '{fname}': {e}")
    print("Done processing all DXF files.")

if __name__ == '__main__':
    main()
