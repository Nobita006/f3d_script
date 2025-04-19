// test-work-item.js

const fs = require('fs');
const axios = require('axios');
const cfg = require('./config'); // Use your existing config

const DM = 'https://developer.api.autodesk.com';

// Function to get a 2-legged token (copied from index.js)
async function getToken() {
  try {
    const resp = await axios.post(
      `${DM}/authentication/v2/token`,
      'grant_type=client_credentials&scope=data:read data:write bucket:create bucket:read code:all',
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        auth: { username: cfg.clientId, password: cfg.clientSecret }
      }
    );
    console.log('token ok');
    return resp.data.access_token;
  } catch (e) {
      console.error('Error getting token:');
      if (e.response) {
          console.error('Status:', e.response.status);
          console.error('Data:', e.response.data);
      } else {
          console.error('Message:', e.message);
      }
      throw new Error('Failed to obtain token.');
  }
}

// Function to generate a presigned URL for PUT (upload) to OSS
async function getPresignedPutUrl(token, objectKey) {
    try {
        const resp = await axios.get(
            `${DM}/oss/v2/buckets/${cfg.bucketKey}/objects/${objectKey}/signeds3upload`,
            {
                headers: { Authorization: `Bearer ${token}` },
                params: { command: 'upload' }
            }
        );
        return resp.data.url || resp.data.urls[0];
    } catch (e) {
        console.error(`Error generating presigned PUT URL for ${objectKey}:`);
        if (e.response) { console.error('Status:', e.response.status, 'Data:', e.response.data, 'URL:', e.config.url); } else { console.error('Message:', e.message); }
        throw e;
    }
}

// Function to generate a presigned URL for GET (download) from OSS
async function getPresignedGetUrl(token, objectKey) {
     try {
        const resp = await axios.get(
            `${DM}/oss/v2/buckets/${cfg.bucketKey}/objects/${objectKey}/signeds3download`,
            {
                headers: { Authorization: `Bearer ${token}` }
            }
        );
        return resp.data.url;
     } catch (e) {
        console.error(`Error generating presigned GET URL for ${objectKey}:`);
         if (e.response) { console.error('Status:', e.response.status, 'Data:', e.response.data, 'URL:', e.config.url); } else { console.error('Message:', e.message); }
        throw e;
     }
}

// Function to get Activity details to find the latest version
async function getActivityVersion(token) {
    const fullActivityId = `${cfg.clientId}.${cfg.activityId}`;
    const encodedActivityId = encodeURIComponent(fullActivityId);
    const url = `${DM}/da/us-east/v3/activities/${encodedActivityId}`;

    console.log(`Fetching Activity details for ${fullActivityId}...`);

    try {
        const resp = await axios.get(url, { headers: { Authorization: `Bearer ${token}` } });
        console.log(`Found Activity ${fullActivityId}, latest version is ${resp.data.version}`);
        return resp.data.version;
    } catch (e) {
         console.error(`Error fetching Activity details for ${fullActivityId}:`);
         if (e.response) { console.error('Status:', e.response.status, 'Data:', e.response.data, 'URL:', e.config.url); } else { console.error('Message:', e.message); }
         throw new Error(`Failed to fetch Activity version for ${fullActivityId}.`);
    }
}


// Submit Work Item and poll for status
async function runTestWorkItem() {
    // Start of the main try block for this function
    try {
        const token = await getToken();

        // Get the latest Activity version
        const activityVersion = await getActivityVersion(token);
        // Construct the activityId string using the version number
        const activityIdWithVersion = `${cfg.clientId}.${cfg.activityId}+${activityVersion}`;
        console.log(`Using Activity ID format: ${activityIdWithVersion}`);

        const timestamp = Date.now(); // Use a timestamp for unique output names per test run

        // Define output file names in OSS using the timestamp
        const outputObjectKeys = {
            TopDXF: `${timestamp}_Top_flat.dxf`,
            Side1DXF: `${timestamp}_Side1_flat.dxf`,
            Side2DXF: `${timestamp}_Side2_flat.dxf`,
            Report: `${timestamp}_report.txt` // The report file is always named 'report.txt' in the job
        };

        // Generate ONLY Presigned PUT URLs for DA to upload to
        const outputArguments = {};
        console.log('Generating presigned PUT URLs for outputs...');
        for (const key in outputObjectKeys) {
            const objectKey = outputObjectKeys[key];
            outputArguments[key] = { url: await getPresignedPutUrl(token, objectKey), verb: 'put' };
            console.log(`Generated PUT URL for ${objectKey}`);
        }


        // Define Work Item payload
        const workItemReq = {
            // Use activityId with version instead of alias
            activityId: activityIdWithVersion,
            arguments: {
                // Input: Template F3D from OSS (requires auth header for private buckets)
                templateF3D: {
                    url: `urn:adsk.objects:os.object:${cfg.bucketKey}/${cfg.templateF3D}`,
                    headers: { 'Authorization': `Bearer ${token}` }, // Needed for DA to access your OSS file
                    verb: 'get' // default, but explicit is good
                },
                // Input: Dims JSON from OSS (requires auth header) or Data URI
                // Using URN from OSS as provisioned by index.js for this test
                dims: {
                     url: `urn:adsk.objects:os.object:${cfg.bucketKey}/${cfg.dimsJson}`,
                     headers: { 'Authorization': `Bearer ${token}` }, // Needed for DA to access your OSS file
                     verb: 'get' // default
                },
                // Outputs: Presigned PUT URLs for OSS that DA will upload to
                TopDXF: outputArguments.TopDXF,
                Side1DXF: outputArguments.Side1DXF,
                Side2DXF: outputArguments.Side2DXF,
                // Report output
                report: outputArguments.Report
            }
        };

        console.log('Submitting Work Item...');
        let wi;
        try {
            wi = (await axios.post(
                `${DM}/da/us-east/v3/workitems`,
                workItemReq,
                { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
            )).data;
            console.log('WorkItem', wi.id, 'submitted.');
        } catch (e) {
             console.error('Error submitting Work Item:');
              if (e.response) { console.error('Status:', e.response.status, 'Data:', e.response.data, 'URL:', e.config.url); } else { console.error('Message:', e.message); }
             throw e; // Re-throw to be caught by the main runTestWorkItem catch
        }


        // Poll until done
        let status = 'pending';
        const pollInterval = 5000; // 5 seconds
        const maxPolls = 60; // 5 minutes total wait time
        console.log('Polling WorkItem status...');

        for (let i = 0; i < maxPolls; i++) {
            await new Promise(r => setTimeout(r, pollInterval)); // Wait

            const statusResp = await axios.get(
                `${DM}/da/us-east/v3/workitems/${wi.id}`,
                { headers: { Authorization: `Bearer ${token}` } }
            );
            status = statusResp.data.status;
            console.log(`WorkItem ${wi.id} status: ${status}`);

            if (status === 'success' || status === 'failed' || status === 'cancelled') {
                break;
            }
            if (i === maxPolls - 1) {
                console.warn('Polling timed out. WorkItem status unknown.');
            }
        }

        console.log(`Final WorkItem status: ${status}`);


        // Generate Presigned GET URLs and Report Results
        console.log('\n--- Work Item Results ---');
        console.log(`Work Item ID: ${wi.id}`);
        console.log(`Status: ${status}`);

        // Generate GET URL for the Report
        try {
            const reportDownloadUrl = await getPresignedGetUrl(token, outputObjectKeys.Report);
            console.log(`Report URL: ${reportDownloadUrl}`);
        } catch (e) {
            console.error(`Could not generate GET URL for Report (${outputObjectKeys.Report}). It might not have been uploaded.`);
             // Log the error for GET URL generation but don't necessarily throw as job status is final
             if (e.response) { console.error('Status:', e.response.status, 'Data:', e.response.data, 'URL:', e.config.url); } else { console.error('Message:', e.message); }
        }


        if (status === 'success') {
            console.log('\nOutput DXF Download URLs (valid for 1 hour):');
            // Generate GET URLs for the DXF outputs ONLY IF successful
            try {
                const topDXFUrl = await getPresignedGetUrl(token, outputObjectKeys.TopDXF);
                const side1DXFUrl = await getPresignedGetUrl(token, outputObjectKeys.Side1DXF);
                const side2DXFUrl = await getPresignedGetUrl(token, outputObjectKeys.Side2DXF);

                console.log(`TopDXF: ${topDXFUrl}`);
                console.log(`Side1DXF: ${side1DXFUrl}`);
                console.log(`Side2DXF: ${side2DXFUrl}`);
                console.log('\nCheck your OSS bucket for files starting with the timestamp:', timestamp);

            } catch (e) {
                 console.error('Error generating GET URLs for DXF outputs. They might not have been uploaded despite success status.');
                 if (e.response) console.error('API Response:', e.response.status, e.response.data);
            }

        } else {
            console.error('Work Item did NOT complete successfully.');
            console.error('Please download and examine the Report URL for details.');
        }
        console.log('-----------------------');

    // End of the main try block for this function
    } catch (err) {
        // This catch handles errors thrown from anywhere inside the main try block,
        // including errors from getToken, getActivityVersion, getPresignedPutUrl,
        // submitting the work item, or errors re-thrown from inner catch blocks.
        console.error('An error occurred during the Work Item execution or setup:');
        // Log error details
        if (err.response) {
           console.error('Status:', err.response.status);
           console.error('Data:', err.response.data);
           console.error('URL:', err.config.url);
           console.error('Method:', err.config.method);
        } else {
           console.error('Message:', err.message);
           // Only log stack trace for unhandled errors that aren't Axios errors
           if (!err.message.startsWith('Error generating') && !err.message.startsWith('Failed to') && !err.message.startsWith('Error submitting')) {
               console.error('Stack:', err.stack);
           }
        }
        // Re-throw the error to be caught by the top-level execution block
        throw err;
    }
}


// Main execution block
(async () => {
  try {
    await runTestWorkItem();
    console.log('Work Item test script finished.');
  } catch (err) {
      console.error('\n--- Top-Level Script Error ---');
      console.error('The script terminated due to an unhandled error:');
      // The detailed error should have been logged by runTestWorkItem's catch
      console.error(err.message || 'Unknown error');
      // console.error(err.stack); // Uncomment for full stack trace if needed
      console.error('--------------------\n');
      process.exit(1); // Exit with a non-zero code to indicate failure
  }
})();