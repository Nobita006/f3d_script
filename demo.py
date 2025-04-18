import adsk.core
import adsk.fusion
import adsk.cam
import traceback
import os

def run(context):
    ui = None
    try:
        app = adsk.core.Application.get()
        ui  = app.userInterface

        # 1. Open the local .f3d file
        # NOTE: Replace with your actual local path
        doc = app.documents.open(r"C:/Users/sayan/OneDrive/Documents/Visual_Studio_2022/Freelance/f3d_script/Acrylic_Box_parametric_screws_v26.f3d")
        
        # Get the active design
        design = adsk.fusion.Design.cast(doc.products.itemByProductType('DesignProductType'))
        if not design:
            ui.messageBox('No active Fusion design', 'Error')
            return
        
        # 2. Update user parameters
        userParams = design.userParameters
        
        # Example new values:
        length_screws = 3
        width_screws  = 2
        length        = 200  # mm
        width         = 400  # mm
        height        = 100  # mm
        
        # Check constraints
        if length_screws <= 0 or width_screws <= 0:
            raise ValueError("Length_Screws and Width_Screws must be > 0.")
        if length < 100 or width < 100 or height < 100:
            raise ValueError("Length, Width, Height must be >= 100 mm.")
        
        # Update the model’s user parameters
        userParams.itemByName('Length_Screws').expression = str(length_screws)
        userParams.itemByName('Width_Screws').expression  = str(width_screws)
        userParams.itemByName('Length').expression        = f"{length} mm"
        userParams.itemByName('Width').expression         = f"{width} mm"
        userParams.itemByName('Height').expression        = f"{height} mm"
        
        # 3. Export the 3 sketches in the "Export" component as DXF
        rootComp = design.rootComponent
        
        # Find the occurrence named "Export" (e.g. "Export:1" in the browser)
        exportOccurrence = None
        for occ in rootComp.occurrences:
            # Adjust this condition if your component name differs
            if occ.name.startswith("Export"):
                exportOccurrence = occ
                break
        
        if not exportOccurrence:
            ui.messageBox("Could not find an occurrence named 'Export' in the browser.")
            return
        
        exportComp = exportOccurrence.component
        exportMgr  = design.exportManager
        
        # For each sketch in the Export component, create a DXF
        # The DXF filename could be based on the sketch’s name
        for sketch in exportComp.sketches:
            dxf_filename = f"C:/Users/sayan/OneDrive/Documents/Visual_Studio_2022/Freelance/f3d_script/{sketch.name}.dxf"
            dxfOptions   = exportMgr.createDXFExportOptions(dxf_filename, sketch)
            exportMgr.execute(dxfOptions)
        
        # 4. Save the updated file locally
        # You can either overwrite the same file or do a "Save As"
        savePath = r"C:/Users/sayan/OneDrive/Documents/Visual_Studio_2022/Freelance/f3d_script/Updated_Box.f3d"
        doc.saveAs(savePath, '', '', '')
        
        ui.messageBox("Parameters updated and sketches exported to DXF successfully!")
        
    except:
        if ui:
            ui.messageBox('Failed:\n{}'.format(traceback.format_exc()))
