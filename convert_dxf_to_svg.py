import ezdxf
from ezdxf.math import Vec2

# Tolerance for matching endpoints
TOLERANCE = 1e-6

def are_points_close(p1, p2, tol=TOLERANCE):
    return (abs(p1.x - p2.x) < tol) and (abs(p1.y - p2.y) < tol)

def join_lines(segments):
    """Attempt to join segments that share endpoints."""
    joined = []
    
    while segments:
        # Start with a segment and try to extend it
        current = segments.pop(0)
        extended = True
        
        while extended:
            extended = False
            for i, seg in enumerate(segments):
                # If the end of current matches the start of seg, append seg
                if are_points_close(current[-1], seg[0]):
                    current += seg[1:]
                    segments.pop(i)
                    extended = True
                    break
                # If the end of current matches the end of seg, reverse seg and append
                elif are_points_close(current[-1], seg[-1]):
                    current += seg[-2::-1]  # reverse excluding the duplicate point
                    segments.pop(i)
                    extended = True
                    break
                # If the start of current matches the end of seg, prepend seg
                elif are_points_close(current[0], seg[-1]):
                    current = seg[:-1] + current
                    segments.pop(i)
                    extended = True
                    break
                # If the start of current matches the start of seg, reverse seg and prepend
                elif are_points_close(current[0], seg[0]):
                    current = seg[1:][::-1] + current
                    segments.pop(i)
                    extended = True
                    break
        joined.append(current)
    return joined

def process_dxf(input_path, output_path):
    # Read the DXF file
    doc = ezdxf.readfile(input_path)
    msp = doc.modelspace()

    # Extract LINE entities from the modelspace
    segments = []
    for line in msp.query('LINE'):
        start = Vec2(*line.dxf.start[:2])
        end = Vec2(*line.dxf.end[:2])
        segments.append([start, end])
    
    # Join contiguous segments
    joined_segments = join_lines(segments)

    # Optionally, remove original LINE entities (or save in a new DXF)
    for e in list(msp.query('LINE')):
        msp.delete_entity(e)

    # Add joined segments as LWPolyline (if closed, set close=True)
    for seg in joined_segments:
        # Determine if the segment forms a closed loop
        is_closed = are_points_close(seg[0], seg[-1]) and len(seg) > 2
        points = [(p.x, p.y) for p in seg]
        msp.add_lwpolyline(points, close=is_closed)

    # Save the new DXF
    doc.saveas(output_path)

# Example usage:
input_dxf = r'C:/Users/sayan/OneDrive/Documents/Visual_Studio_2022/Freelance/f3d_script/Side2_face.dxf'
output_dxf = r'C:/Users/sayan/OneDrive/Documents/Visual_Studio_2022/Freelance/f3d_script/Side2_face_joined.dxf'
process_dxf(input_dxf, output_dxf)
