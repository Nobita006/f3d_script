# app.py
# Local web server using Flask to receive parameters and trigger Fusion 360 script

from flask import Flask, request, render_template_string, jsonify
import json
import os
import subprocess
import sys
import time # Import time module for small delays

app = Flask(__name__)

# --- Configuration ---
# !!! IMPORTANT: Set this to the directory where you want the dims.json file
#                and the exported DXF files to be saved.
#                This MUST match the EXPORT_DIR setting in your Fusion 360 script.
EXPORT_DIR = r"C:\Users\sayan\OneDrive\Documents\Visual_Studio_2022\Freelance\f3d_script\MVP\localhost" # <-- VERIFY THIS PATH!
DIMS_JSON  = os.path.join(EXPORT_DIR, 'dims.json')

# !!! IMPORTANT: Set this to the actual full path of your Fusion 360 executable (FusionLauncher.exe or Fusion 360.exe).
#                Find this path on your system. Common locations:
#                - C:\Program Files\Autodesk\Fusion 360\Fusion 360.exe
#                - %LOCALAPPDATA%\Autodesk\webdeploy\production\<some_hash>\FusionLauncher.exe
#                The example path below is illustrative - YOU MUST FIND YOURS.
FUSION_PATH = r"C:/Users/sayan/AppData/Local/Autodesk/webdeploy/production/6a0c9611291d45bb9226980209917c3d/FusionLauncher.exe" # <-- VERIFY THIS PATH!

# !!! IMPORTANT: Set this to the actual full path of your Fusion 360 Python script (.py file).
#                In Fusion 360: File -> Scripts and Add-ins, select your script, click "Details", copy "Full Path".
#                This should point to the *simplified script* that operates on the active document.
#                The example path below is illustrative - YOU MUST FIND YOURS.
SCRIPT_PATH = r"C:\Users\sayan\AppData\Roaming\Autodesk\Autodesk Fusion 360\API\Scripts\NewScript1\NewScript1.py" # <-- VERIFY THIS PATH!

# --- HTML Template for the Web Form ---
HTML_FORM = """
<!doctype html>
<html>
<head>
    <title>Fusion 360 Parameter Control</title>
    <style>
        body { font-family: sans-serif; line-height: 1.6; padding: 20px; }
        .container { max-width: 600px; margin: 0 auto; background: #f9f9f9; padding: 20px; border-radius: 8px; }
        h2 { text-align: center; margin-bottom: 20px; color: #333; }
        label { display: block; margin-bottom: 5px; font-weight: bold; }
        input[type="number"] { width: calc(100% - 22px); padding: 10px; margin-bottom: 15px; border: 1px solid #ccc; border-radius: 4px; }
        button {
            display: block;
            width: 100%;
            padding: 12px;
            background-color: #007bff;
            color: white;
            border: none;
            border-radius: 4px;
            font-size: 16px;
            cursor: pointer;
            transition: background-color 0.3s ease;
        }
        button:hover { background-color: #0056b3; }
        .message { margin-top: 20px; padding: 10px; border-radius: 4px; }
        .success { background-color: #d4edda; color: #155724; border: 1px solid #c3e6cb; }
        .error { background-color: #f8d7da; color: #721c24; border: 1px solid #f5c6cb; }
        .info { background-color: #cfe2ff; color: #084298; border: 1px solid #b6d4fe; }
    </style>
</head>
<body>
    <div class="container">
        <h2>Fusion 360 Parameter Control</h2>
        <form method="POST" action="/">
            <label for="Length">Length (mm):</label>
            <input type="number" id="Length" name="Length" step="any" required value="200"><br><br>

            <label for="Width">Width (mm):</label>
            <input type="number" id="Width" name="Width" step="any" required value="400"><br><br>

            <label for="Height">Height (mm):</label>
            <input type="number" id="Height" name="Height" step="any" required value="100"><br><br>

            <label for="Length_Screws">Length Screws:</label>
            <input type="number" id="Length_Screws" name="Length_Screws" step="1" required value="4"><br><br>

            <label for="Width_Screws">Width Screws:</label>
            <input type="number" id="Width_Screws" name="Width_Screws" step="1" required value="4"><br><br>

            <button type="submit">Update Parameters & Run Export</button>
        </form>

        {% if message %}
            <div class="message {{ message_type }}">{{ message }}</div>
            {% if export_dir %}
                <div class="info">Export files should appear in: <code>{{ export_dir }}</code></div>
            {% endif %}
            <div class="info">Check Fusion 360 UI for detailed script status messages.</div>
        {% endif %}
    </div>
</body>
</html>
"""

@app.route('/', methods=['GET', 'POST'])
def index():
    message = None
    message_type = None
    export_dir_display = None

    if request.method == 'POST':
        try:
            # Get data from the form, handling potential ValueErrors for incorrect types
            # Use .get with default values to prevent errors if a field is missing
            length_screws = int(request.form.get('Length_Screws', 0))
            width_screws = int(request.form.get('Width_Screws', 0))
            length = float(request.form.get('Length', 0.0))
            width = float(request.form.get('Width', 0.0))
            height = float(request.form.get('Height', 0.0))

            new_dims = {
                'Length_Screws': length_screws,
                'Width_Screws': width_screws,
                'Length': length,
                'Width': width,
                'Height': height
            }

            # Ensure export directory exists
            try:
                os.makedirs(EXPORT_DIR, exist_ok=True)
            except Exception as dir_e:
                 message = f"Error creating export directory {EXPORT_DIR}: {dir_e}"
                 message_type = "error"
                 # Continue, as directory might exist, but report the issue.


            # Write updated dimensions to JSON file
            try:
                with open(DIMS_JSON, 'w') as f:
                    json.dump(new_dims, f, indent=2)
                # Add a small delay to ensure the file system write is complete before Fusion tries to read
                time.sleep(0.1)
            except Exception as json_e:
                 message = f"Error writing to {DIMS_JSON}: {json_e}"
                 message_type = "error"
                 # Can't proceed if JSON write fails, return early
                 return render_template_string(HTML_FORM, message=message, message_type=message_type, export_dir=EXPORT_DIR)


            # --- Trigger Fusion 360 Script ---
            # This attempts to run the specified script using Fusion 360's command line.
            # The script itself MUST be designed to handle the file (either open it
            # or operate on the active document, like the simplified version).
            try:
                command = [
                    FUSION_PATH,
                    '/runscript', # Command-line argument to run a script
                    SCRIPT_PATH   # Full path to the Python script file
                ]

                # Use subprocess.Popen to run the command in the background.
                # This means the web server's response is sent back immediately,
                # and Fusion 360 runs the script separately.
                # shell=False is generally safer than shell=True.
                process = subprocess.Popen(
                    command,
                    shell=False,
                    stdout=subprocess.PIPE, # Capture stdout (for debugging script output if needed)
                    stderr=subprocess.PIPE, # Capture stderr
                    # start_new_session=True # Can sometimes help detach the process on Windows
                )

                # Give the command a brief moment to register, though Popen is non-blocking
                time.sleep(0.5)

                # Set success message if trigger command was sent without FileNotFoundError
                # Check if an error message was already set (e.g., from directory creation)
                if message_type != "error":
                    message = "Parameters updated and script trigger sent to Fusion 360."
                    message_type = "success"
                export_dir_display = EXPORT_DIR

            except FileNotFoundError:
                 message = f"Error: Fusion 360 executable not found at '{FUSION_PATH}'. Please check FUSION_PATH configuration in app.py."
                 message_type = "error"
            except Exception as trigger_e:
                 message = f"An unexpected error occurred while trying to trigger Fusion 360 script: {trigger_e}. Check FUSION_PATH and SCRIPT_PATH in app.py."
                 message_type = "error"


        except ValueError:
            # This catches errors if form data cannot be converted to int or float
            message = "Invalid input received. Please ensure you are entering numbers."
            message_type = "error"
        except Exception as e:
            # Catch any other unexpected errors during form processing or JSON writing
            message = f"An unexpected error occurred during processing: {e}"
            message_type = "error"

    # Render the form, displaying messages if any occurred
    return render_template_string(HTML_FORM, message=message, message_type=message_type, export_dir=export_dir_display)

if __name__ == '__main__':
    # Run the Flask development server.
    # debug=True: Auto-reloads code on changes, provides detailed error pages. Good for development.
    # debug=False: Use for production.
    # host='localhost': Server is only accessible from your computer. Use '0.0.0.0' to access from other devices on your network (be mindful of security).
    # port=5000: The port the server listens on.
    print(f"Starting Flask server on http://localhost:5000/")
    print(f"Remember: Ensure your target Fusion 360 design is OPEN and ACTIVE.")
    print(f"Verify configuration paths in app.py:")
    print(f" EXPORT_DIR: {EXPORT_DIR}")
    print(f" FUSION_PATH: {FUSION_PATH}")
    print(f" SCRIPT_PATH: {SCRIPT_PATH}")

    app.run(debug=True, port=5000, host='localhost')