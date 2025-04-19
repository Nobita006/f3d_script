/// <reference types="@adsk/core" />
/// <reference types="@adsk/fusion" />

import * as adsk from 'adsk'; // This import is usually assumed or provided by the DA environment
import * as fs from 'fs';   // Node.js file system module, generally available in DA
import * as path from 'path'; // Node.js path module, generally available in DA

// ───────────── configure once ─────────────
// DA working directory is the current working directory
const EXPORT_DIR = process.cwd();
const DIMS_JSON = 'dims.json'; // DA will inject dims.json here by localName

// Default values (fallback if JSON is missing or a key is absent)
const DEFAULT_DIMS = {
    'Length_Screws': 4,
    'Width_Screws': 4,
    'Length': 200.0, // Use float type consistently
    'Width': 400.0,
    'Height': 100.0
};

const TARGET_PREFIXES = ['top', 'side1', 'side2']; // components to export
const POLYLINE_TOLERANCE = 1e-4; // mm
// ───────────────────────────────────────────

function load_dimensions(): typeof DEFAULT_DIMS {
    /**
     * Load the dims JSON if present, otherwise return DEFAULT_DIMS.
     * In DA, console.log/error goes to the report file.
     */
    console.log(`Looking for ${DIMS_JSON} in ${process.cwd()}`);
    if (fs.existsSync(DIMS_JSON)) {
        try {
            const data = JSON.parse(fs.readFileSync(DIMS_JSON, 'utf8'));
            console.log(`Found and parsed ${DIMS_JSON}`);
            // cast and fallback to defaults
            return {
                'Length_Screws': parseInt(data.Length_Screws || DEFAULT_DIMS.Length_Screws),
                'Width_Screws': parseInt(data.Width_Screws || DEFAULT_DIMS.Width_Screws),
                'Length': parseFloat(data.Length || DEFAULT_DIMS.Length),
                'Width': parseFloat(data.Width || DEFAULT_DIMS.Width),
                'Height': parseFloat(data.Height || DEFAULT_DIMS.Height)
            };
        } catch (e: any) { // Use 'any' or a more specific Error type if preferred
            console.error(`Failed to parse ${DIMS_JSON}: ${e.message || e}\nUsing defaults.`);
        }
    } else {
        console.log(`${DIMS_JSON} not found. Using defaults.`);
    }
    // Return a copy to avoid modifying the original default object
    return { ...DEFAULT_DIMS };
}

function largest_planar_face(body: adsk.fusion.BRepBody): adsk.fusion.BRepFace | null {
    let best: adsk.fusion.BRepFace | null = null;
    let area = 0.0;
    for (let i = 0; i < body.faces.count; i++) {
        const face = body.faces.item(i);
        if (face && face.geometry.objectType === adsk.core.Plane.classType()) {
             // Access geometry properties based on the specific type (Plane)
             // Note: Calculating area this way might require casting or more complex API use
             // A simpler approach might be to trust Fusion's flat pattern creation on planar faces.
             // For this translation, we'll keep the spirit of checking for planar faces.
             // Getting the actual area of a BRepFace might require evaluation.
             // Let's simplify the logic to just find *a* planar face if needed for flat pattern.
             // If the original Python worked by area, let's try to mimic, but be aware of potential API differences.
             // Let's assume face.area exists for BRepFace in TS API as it does in Python.
             try { // Add try-catch in case face.area is not reliable or throws
                 if ((face as any).area > area) { // Use 'any' if 'area' isn't directly typed on BRepFace
                     best = face;
                     area = (face as any).area;
                 }
             } catch(e) {
                 // Handle potential error if area access fails
                 console.warn(`Could not get area for face: ${e}`);
                 // As a fallback, just return the first planar face found if area is hard to get
                 if (!best && face.geometry.objectType === adsk.core.Plane.classType()) {
                      best = face;
                 }
             }
        }
    }
     // Refined logic: Just find the first planar face if area comparison is problematic
     for (let i = 0; i < body.faces.count; i++) {
        const face = body.faces.item(i);
        if (face && face.geometry.objectType === adsk.core.Plane.classType()) {
             return face; // Return the first one found
        }
     }

    return null; // No planar face found
}


function flat_pattern_for(comp: adsk.fusion.Component): adsk.fusion.FlatPattern | null {
    if (comp.flatPattern) {
        return comp.flatPattern;
    }
    if (comp.bRepBodies.count === 0) {
        return null;
    }
    const face = largest_planar_face(comp.bRepBodies.item(0));
    // Note: createFlatPattern might require the component to be the active component.
    // In Design Automation, the document opens and becomes active, the root is active.
    // Creating FP on occurrences might need specific handling or performing on the root's instance of the component.
    // Let's try creating on the component directly first.
    return face ? comp.createFlatPattern(face) : null;
}

// ───────────────────────── main ─────────────────────────
export function run(context: any): void { // export run is common for TS add-ins
    let ui: adsk.core.UserInterface | null = null;
    try {
        const app = adsk.core.Application.get();
        ui = app.userInterface; // ui is available in DA, logs to report

        console.log('Design Automation script started.'); // Log to report

        // Load dims (from JSON or defaults)
        const dims = load_dimensions();
        console.log('Loaded dimensions:', JSON.stringify(dims));

        // 1) Open design & cast
        // In DA, the target file (templateF3D input) is already opened as the active document
        const design = adsk.fusion.Design.cast(app.activeProduct);
        if (!design) {
            console.error('No Fusion design active.');
            ui.messageBox('No Fusion design active.'); // Also send to message box for report clarity
            return;
        }
        console.log(`Design active: ${design.rootComponent.name}`);


        // 2) Update user parameters
        const p = design.userParameters;
        console.log('Updating user parameters...');
        try {
            p.itemByName('Length_Screws').expression = String(dims.Length_Screws); // Ensure string
            p.itemByName('Width_Screws').expression = String(dims.Width_Screws);
            p.itemByName('Length').expression = `${dims.Length} mm`; // Use template literal for units
            p.itemByName('Width').expression = `${dims.Width} mm`;
            p.itemByName('Height').expression = `${dims.Height} mm`;
            console.log('User parameters updated.');
        } catch (paramError: any) {
             console.error(`Failed to update parameters: ${paramError.message || paramError}`);
             ui.messageBox(`Failed to update parameters:\n${paramError.message || paramError}`);
             // Decide if this should be a fatal error or just a warning
             // For now, let's proceed, the geometry might not update correctly
        }


        // Ensure computations are done after parameter changes - generally automatic but good practice
         app.activeProduct.regenerate(); // Forces regeneration


        // 3) Prepare export directory
        console.log(`Ensuring export directory exists: ${EXPORT_DIR}`);
        // Use sync version for simplicity in DA script, or async with await
        try {
            fs.mkdirSync(EXPORT_DIR, { recursive: true });
            console.log('Export directory ensured.');
        } catch (mkdirError: any) {
             console.error(`Failed to create export directory: ${mkdirError.message || mkdirError}`);
             ui.messageBox(`Failed to create export directory:\n${mkdirError.message || mkdirError}`);
             // This is likely a fatal error as we can't write outputs
             return; // Exit if directory cannot be created
        }


        // 4) Loop occurrences and export
        const exp_mgr = design.exportManager;
        const root = design.rootComponent;

        const exported: string[] = [];
        const skipped: string[] = [];

        console.log('Processing occurrences for export...');
        for (let i = 0; i < root.occurrences.count; i++) {
            const occ = root.occurrences.item(i);
            if (!occ) continue; // Should not happen, but good check
            const name = occ.name.toLowerCase();

            // Check name prefixes
            const shouldProcess = TARGET_PREFIXES.some(pref => name.startsWith(pref));

            // Added check for 'mirror' as in Python, though not clear why it's needed.
            // If the component name *contains* 'mirror', skip? Or occurrence name?
            // Assuming occurrence name based on Python.
             if (name.includes('mirror') || !shouldProcess) {
                console.log(`Skipping occurrence "${occ.name}" (contains 'mirror' or not in target prefixes)`);
                continue;
            }

            // Get or create flat pattern for the *component* of the occurrence
            const comp = occ.component;
            console.log(`Processing component "${comp.name}" from occurrence "${occ.name}"`);

            let flat: adsk.fusion.FlatPattern | null = null;
            try {
                 flat = flat_pattern_for(comp);
                 if (!flat) {
                     skipped.push(occ.name); // Use occurrence name for skipped report clarity
                     console.warn(`Skipped "${occ.name}" (component "${comp.name}"): Could not create flat pattern.`);
                     continue;
                 }
                  console.log(`Flat pattern found or created for component "${comp.name}".`);
            } catch (fpError: any) {
                 skipped.push(occ.name); // Use occurrence name
                 console.error(`Error creating/getting flat pattern for "${occ.name}" (component "${comp.name}"): ${fpError.message || fpError}`);
                 continue; // Skip this occurrence if FP fails
            }


            const compName = comp.name; // Use component name as in Python logic for file naming
            const dxfFileName = `${compName}_flat.dxf`;
            const dxfFilePath = path.join(EXPORT_DIR, dxfFileName);

            console.log(`Attempting to export DXF for "${compName}" to "${dxfFilePath}"`);
            try {
                const opts = exp_mgr.createDXFFlatPatternExportOptions(dxfFilePath, flat);

                // Set polyline conversion options - check if properties exist
                if (opts) { // Ensure opts object was created
                    if (opts.isSplineConvertedToPolyline !== undefined) {
                        opts.isSplineConvertedToPolyline = true;
                    }
                    if (opts.convertToPolylineTolerance !== undefined) {
                        opts.convertToPolylineTolerance = POLYLINE_TOLERANCE;
                    }
                }


                const success = exp_mgr.execute(opts);
                if (success) {
                    exported.push(compName); // Use component name for exported report
                    console.log(`Successfully exported "${dxfFileName}".`);
                } else {
                     skipped.push(occ.name); // Use occurrence name for skipped report
                     console.warn(`Export failed for "${dxfFileName}" but did not throw an error.`);
                }

            } catch (exportError: any) {
                 skipped.push(occ.name); // Use occurrence name
                 console.error(`Error during DXF export for "${dxfFileName}": ${exportError.message || exportError}`);
                 ui.messageBox(`Export failed for ${dxfFileName}:\n${exportError.message || exportError}`);
            }
        }

        // 5) Report
        let msg = `Design Automation job finished.\n`;
        msg += `Exported DXF files: ${exported.length ? exported.join(', ') : '-'}\n`;
        if (skipped.length > 0) {
            msg += `Skipped occurrences (no flat pattern or export failed): ${skipped.join(', ')}\n`;
        }
        console.log(msg); // Log summary to report

        // Optional: Final message box in case the report is not immediately visible
        if (ui) {
             ui.messageBox(msg);
        }


    } catch (error: any) {
        // Generic catch for any unexpected errors during execution
        console.error('Caught an unexpected error during script execution:');
        // In DA, traceback is not directly available like in Python.
        // Logging the error object or message is standard.
        console.error(error.message || error);
        console.error(error.stack); // Log stack trace if available

        if (ui) {
            ui.messageBox('Script failed:\n' + (error.message || error));
        }
    }
    console.log('Design Automation script ended.');
}

// Note: In Design Automation, the 'run' function is automatically invoked.
// You do not need to call run() manually outside the function definition.