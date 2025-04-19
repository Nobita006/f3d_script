// index.js

const fs    = require('fs');
const axios = require('axios');
const cfg   = require('./config');

const DM = 'https://developer.api.autodesk.com';

// 1) Get 2‑legged token
async function getToken() {
  try { // Added try/catch for token
    const resp = await axios.post(
      `${DM}/authentication/v2/token`,
      'grant_type=client_credentials&scope=data:read data:write bucket:create bucket:read code:all',
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        auth: { username: cfg.clientId, password: cfg.clientSecret }
      }
    );
     console.log('token ok'); // Log success here
    return resp.data.access_token;
  } catch (e) {
      console.error('Error getting token:');
      if (e.response) {
          console.error('Status:', e.response.status);
          console.error('Data:', e.response.data);
      } else {
          console.error('Message:', e.message);
      }
      throw new Error('Failed to obtain token.'); // Throw specific error message
  }
}

// 2) Create bucket if needed
async function ensureBucket(token) {
  try {
    await axios.post(
      `${DM}/oss/v2/buckets`,
      { bucketKey: cfg.bucketKey, policyKey: 'persistent' },
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
    );
    console.log('Bucket created');
  } catch (e) {
    if (e.response && e.response.status === 409) {
      console.log('Bucket exists');
    } else {
      // Log error details before re-throwing
      console.error('Error during bucket creation:');
      if (e.response) {
          console.error('Status:', e.response.status);
          console.error('Data:', e.response.data);
          console.error('URL:', e.config.url);
      } else {
          console.error('Message:', e.message);
      }
      throw e;
    }
  }
}

// 3) Upload any file via signeds3upload
async function uploadOSS(token, localFile, objectKey) {
  try {
    const size = fs.statSync(localFile).size;
    // 3a) presign
    const pre = await axios.get(
      `${DM}/oss/v2/buckets/${cfg.bucketKey}/objects/${objectKey}/signeds3upload`,
      {
        params: { partNumbers: 1, contentLength: size },
        headers: { Authorization: `Bearer ${token}` }
      }
    );
    const uploadUrl = pre.data.url || pre.data.urls[0];
    // const uploadKey = pre.data.uploadKey; // uploadKey is only needed for multi-part upload completion if not part 1

    // 3b) PUT to S3
    // Removed uploadKey from here as it's not used in simple PUT
    await axios.put(
      uploadUrl,
      fs.readFileSync(localFile),
      { headers: { 'Content-Type': 'application/octet-stream' } }
    );

    // 3c) complete upload (only needed for multipart upload, which signeds3upload for 1 part handles)
    // For a single part upload, the PUT to the presigned URL is often sufficient,
    // but the documentation for signedS3Upload seems to imply a completion step.
    // Let's keep it as is for now as it was in your original working upload code,
    // but be aware this might be over-complication for single part.
    // await axios.post(
    //   `${DM}/oss/v2/buckets/${cfg.bucketKey}/objects/${objectKey}/signeds3upload`,
    //   { uploadKey }, // uploadKey is needed here for multipart completion
    //   { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
    // );

    console.log(`Uploaded ${objectKey}`);
  } catch(e) {
      console.error(`Error during OSS upload for ${localFile}:`);
       if (e.response) {
          console.error('Status:', e.response.status);
          console.error('Data:', e.response.data);
          console.error('URL:', e.config.url);
       } else {
          console.error('Message:', e.message);
       }
       throw e;
  }
}

// 4) Create or version AppBundle
async function createAppBundle(token) {
  const zipUrn = `urn:adsk.objects:os.object:${cfg.bucketKey}/${cfg.appBundleZip}`;
  let ab;

  try {
    // Try creating new AppBundle
    const resp = await axios.post( // Capture response
      `${DM}/da/us-east/v3/appbundles`,
      { id: cfg.appBundle, engine: 'Autodesk.Fusion+Latest', description: 'DXF export', zipFileUrn: zipUrn },
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
    );
    ab = resp.data; // Store data
    console.log('AppBundle created, version', ab.version);
  } catch (e) {
    // Add more detailed logging for debugging
    console.error(`Error during AppBundle creation POST attempt for ${cfg.appBundle}:`);
    if (e.response) {
        console.error('Status:', e.response.status);
        console.error('Data:', e.response.data);
        console.error('URL:', e.config.url);
    } else {
        console.error('Message:', e.message);
    }

    if (e.response && e.response.status === 409) {
      // Already exists → bump version
      try { // Wrap PATCH in its own try/catch
         const resp = await axios.post( // Capture response
           `${DM}/da/us-east/v3/appbundles/${cfg.appBundle}/versions`,
           { engine: 'Autodesk.Fusion+Latest', zipFileUrn: zipUrn },
           { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
         );
         ab = resp.data; // Store data
         console.log('AppBundle version bumped to', ab.version);
      } catch (patchError) {
          console.error(`Error during AppBundle version bump POST attempt for ${cfg.appBundle}:`);
           if (patchError.response) {
              console.error('Status:', patchError.response.status);
              console.error('Data:', patchError.response.data);
              console.error('URL:', patchError.config.url);
           } else {
              console.error('Message:', patchError.message);
           }
           throw patchError; // Re-throw the patch error
      }
    } else {
      throw e; // Re-throw the original error if not a 409
    }
  }

  // 4b) Create alias 'prod'
  try {
    await axios.post(
      `${DM}/da/us-east/v3/appbundles/${cfg.appBundle}/aliases`,
      { id: 'prod', version: ab.version },
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
    );
    console.log('Alias prod created');
  } catch (e) {
    if (e.response && e.response.status === 409) {
      console.log('Alias prod exists');
    } else {
        console.error(`Error during AppBundle Alias creation POST attempt for ${cfg.appBundle}+prod:`);
        if (e.response) {
            console.error('Status:', e.response.status);
            console.error('Data:', e.response.data);
            console.error('URL:', e.config.url);
        } else {
            console.error('Message:', e.message);
        }
      throw e;
    }
  }
}

// 5) Create or update Activity
async function createActivity(token) {
  const shortId = cfg.activityId;
  const fullId  = `${cfg.clientId}.${cfg.activityId}`; // e.g. "yourClientId.ParametricDXFActivity"

  const def = {
    id: shortId,  // short ID in JSON body
    engine: 'Autodesk.Fusion+Latest',
    commandLine: [
      '$(engine.path)\\FusionCoreConsole.exe'
    ],
    appbundles: [`${cfg.clientId}.${cfg.appBundle}+prod`], // References AppBundle alias
    parameters: {
      templateF3D: { localName: cfg.templateF3D, verb: 'get' },
      dims:        { localName: cfg.dimsJson,    verb: 'get' },
      TopDXF:      { localName: 'Top_flat.dxf',  verb: 'put' },
      Side1DXF:    { localName: 'Side1_flat.dxf',verb: 'put' },
      Side2DXF:    { localName: 'Side2_flat.dxf',verb: 'put' }
    }
  };

  let activityData; // Variable to store the activity data (including version)

  try {
    // Try creating new Activity
    const resp = await axios.post( // Capture response
      `${DM}/da/us-east/v3/activities`,
      def,
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
    );
    activityData = resp.data; // Store data
    console.log('Activity created:', fullId, 'version', activityData.version); // Log version
  } catch (e) {
    console.error(`Error during initial Activity creation POST attempt for ${fullId}:`);
    if (e.response) {
        console.error('Status:', e.response.status);
        console.error('Data:', e.response.data);
        console.error('URL:', e.config.url);
        console.error('Method:', e.config.method);
    } else {
        console.error('Message:', e.message);
    }

    if (e.response && e.response.status === 409) {
      // update existing using full qualified ID in URL
      try {
          const resp = await axios.patch( // Capture response
            `${DM}/da/us-east/v3/activities/${encodeURIComponent(fullId)}`,
            def,
            { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
          );
          activityData = resp.data; // Store data
          console.log('Activity updated:', fullId, 'version', activityData.version); // Log version
      } catch (patchError) {
          console.error(`Error during Activity update PATCH attempt for ${fullId} after 409 on POST:`);
           if (patchError.response) {
              console.error('Status:', patchError.response.status);
              console.error('Data:', patchError.response.data);
              console.error('URL:', patchError.config.url);
              console.error('Method:', patchError.config.method);
           } else {
              console.error('Message:', patchError.message);
           }
           throw patchError;
      }
    } else {
      throw e;
    }
  }

  // --- NEW STEP: Create or update alias for the Activity using cfg.activityAlias ---
  if (!activityData || !activityData.version) {
      console.error('Could not determine Activity version for alias creation.');
      return; // Exit function if version is unknown
  }

  const aliasId = cfg.activityAlias; // Use the alias from config
  const aliasUrl = `${DM}/da/us-east/v3/activities/${encodeURIComponent(fullId)}/aliases`;
  const aliasPayload = { id: aliasId, version: activityData.version };

  console.log(`Attempting to create/update alias '${aliasId}' for Activity ${fullId}`);
  console.log(`POST URL: ${aliasUrl}`);
  console.log(`POST Payload: ${JSON.stringify(aliasPayload)}`); // Log the payload being sent

  try {
    await axios.post(
      aliasUrl, // Use the logged URL
      aliasPayload, // Use the logged payload object
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
    );
    console.log(`Alias ${aliasId} created for Activity ${fullId} pointing to version ${activityData.version}`);
  } catch (e) {
    if (e.response && e.response.status === 409) {
      console.log(`Alias ${aliasId} exists for Activity ${fullId}. Assuming it points to the correct version.`);
    } else {
        console.error(`Error during Activity Alias creation POST attempt for ${fullId}+${aliasId}:`);
        if (e.response) {
            console.error('Status:', e.response.status);
            console.error('Data:', e.response.data);
            console.error('URL:', e.config.url);
        } else {
            console.error('Message:', e.message);
        }
      throw e;
    }
  }
  // --- End NEW STEP ---
}

// REMOVE THE runWorkItem FUNCTION - Execution is handled by AWS Lambda
/*
async function runWorkItem(token) {
  // ... (removed)
}
*/

// Main entry point
(async () => {
  try {
    const token = await getToken();
    // console.log('token ok'); // Log moved inside getToken for immediate feedback
    await ensureBucket(token);
    await uploadOSS(token, cfg.templateF3D,  cfg.templateF3D);
    await uploadOSS(token, cfg.dimsJson,     cfg.dimsJson);
    await uploadOSS(token, cfg.appBundleZip, cfg.appBundleZip);
    await createAppBundle(token);
    await createActivity(token);
    // REMOVE THE CALL TO runWorkItem
    // await runWorkItem(token);
    console.log('Forge provisioning steps completed successfully.');
  } catch (err) {
      console.error('\n--- Script Error ---');
      console.error('An error occurred during the provisioning process:');
      // Check if it's an axios error and if its details were already logged by the functions
      if (err.response || err.message.startsWith('Error during') || err.message.startsWith('Failed')) {
         console.error('Details should be logged above.');
      } else {
         console.error(err.message);
         // console.error(err.stack); // Uncomment for full stack trace if needed
      }
      console.error('--------------------\n');
      process.exit(1); // Exit with a non-zero code to indicate failure
  }
})();