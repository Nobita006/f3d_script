// index.js

const fs    = require('fs');
const axios = require('axios');
const cfg   = require('./config');

const DM = 'https://developer.api.autodesk.com';

// 1) Get 2‑legged token
async function getToken() {
  const resp = await axios.post(
    `${DM}/authentication/v2/token`,
    'grant_type=client_credentials&scope=data:read data:write bucket:create bucket:read code:all',
    {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      auth: { username: cfg.clientId, password: cfg.clientSecret }
    }
  );
  return resp.data.access_token;
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
    const uploadKey = pre.data.uploadKey;

    // 3b) PUT to S3
    await axios.put(
      uploadUrl,
      fs.readFileSync(localFile),
      { headers: { 'Content-Type': 'application/octet-stream' } }
    );

    // 3c) complete upload
    await axios.post(
      `${DM}/oss/v2/buckets/${cfg.bucketKey}/objects/${objectKey}/signeds3upload`,
      { uploadKey },
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
    );

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
    ab = (await axios.post(
      `${DM}/da/us-east/v3/appbundles`,
      { id: cfg.appBundle, engine: 'Autodesk.Fusion+Latest', description: 'DXF export', zipFileUrn: zipUrn },
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
    )).data;
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
         ab = (await axios.post(
           `${DM}/da/us-east/v3/appbundles/${cfg.appBundle}/versions`,
           { engine: 'Autodesk.Fusion+Latest', zipFileUrn: zipUrn },
           { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
         )).data;
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
        console.error(`Error during Alias creation POST attempt for ${cfg.appBundle}+prod:`);
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
  const fullId  = `${cfg.clientId}.${cfg.activityId}`;

  const def = {
    id: shortId,
    engine: 'Autodesk.Fusion+Latest',
    // CORRECTED commandLine for Fusion Design Automation TypeScript AppBundle
    commandLine: [
      '$(engine.path)\\FusionCoreConsole.exe'
      // The script itself handles reading inputs and writing outputs
    ],
    appbundles: [`${cfg.clientId}.${cfg.appBundle}+prod`],
    parameters: {
      templateF3D: { localName: cfg.templateF3D, verb: 'get' },
      dims:        { localName: cfg.dimsJson,    verb: 'get' },
      TopDXF:      { localName: 'Top_flat.dxf',  verb: 'put' },
      Side1DXF:    { localName: 'Side1_flat.dxf',verb: 'put' },
      Side2DXF:    { localName: 'Side2_flat.dxf',verb: 'put' }
    }
  };

  try {
    await axios.post(
      `${DM}/da/us-east/v3/activities`,
      def,
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
    );
    console.log('Activity created:', fullId);
  } catch (e) {
    // Add more detailed logging for debugging
    console.error(`Error during initial Activity creation POST attempt for ${fullId}:`);
    if (e.response) {
        console.error('Status:', e.response.status);
        console.error('Data:', e.response.data);
        console.error('URL:', e.config.url); // Log the URL that failed
        console.error('Method:', e.config.method); // Log the method (POST)
    } else {
        console.error('Message:', e.message);
    }

    if (e.response && e.response.status === 409) {
      // update existing using full qualified ID in URL
      try { // Add try/catch for PATCH as well
         await axios.patch(
           `${DM}/da/us-east/v3/activities/${encodeURIComponent(fullId)}`,
           def,
           { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
         );
         console.log('Activity updated:', fullId);
      } catch(patchError) {
         console.error(`Error during Activity update PATCH attempt for ${fullId} after 409 on POST:`);
         if (patchError.response) {
             console.error('Status:', patchError.response.status);
             console.error('Data:', patchError.response.data);
             console.error('URL:', patchError.config.url);
             console.error('Method:', patchError.config.method);
         } else {
             console.error('Message:', patchError.message);
         }
         throw patchError; // Re-throw the specific patch error
      }
    } else {
      // If not a 409, something else went wrong during the POST
      // The detailed logging above covers this, now re-throw
      throw e;
    }
  }
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
    console.log('token ok');
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
      console.error(err.message);
      // If it's an axios error, the details were already logged inside the function
      console.error('--------------------\n');
      process.exit(1); // Exit with a non-zero code to indicate failure
  }
})();