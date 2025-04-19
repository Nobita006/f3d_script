// delete-activity.js

const axios = require('axios');
const cfg = require('./config'); // Use your existing config

const DM = 'https://developer.api.autodesk.com';

// Function to get a 2-legged token (copied from index.js)
// We need token:read and token:write for the token itself,
// and code:all to delete Design Automation resources.
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
    console.log('Token obtained successfully.');
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

// Function to delete the Design Automation Activity
async function deleteActivity(token) {
    const fullActivityId = `${cfg.clientId}.${cfg.activityId}`;
    const encodedActivityId = encodeURIComponent(fullActivityId);
    const url = `${DM}/da/us-east/v3/activities/${encodedActivityId}`;

    console.log(`Attempting to delete Activity: ${fullActivityId}`);
    console.log(`DELETE URL: ${url}`);

    try {
        // Use axios.delete for DELETE requests
        await axios.delete(
            url,
            { headers: { Authorization: `Bearer ${token}` } }
        );
        // A successful DELETE usually returns 204 No Content, which doesn't throw
        console.log(`Activity ${fullActivityId} deleted successfully (or did not exist).`);
    } catch (e) {
        // Check if the error is a 404 Not Found, which is also a "success" for deletion intent
        if (e.response && e.response.status === 404) {
            console.log(`Activity ${fullActivityId} not found (already deleted or never existed).`);
        } else {
            console.error(`Error deleting Activity ${fullActivityId}:`);
            if (e.response) {
                console.error('Status:', e.response.status);
                console.error('Data:', e.response.data);
                console.error('URL:', e.config.url);
                console.error('Method:', e.config.method);
            } else {
                console.error('Message:', e.message);
            }
            throw new Error(`Failed to delete Activity ${fullActivityId}.`);
        }
    }
}

// Main execution block
(async () => {
  try {
    const token = await getToken();
    await deleteActivity(token);
    console.log('Activity deletion script finished.');
  } catch (err) {
      console.error('\n--- Script Error ---');
      console.error(err.message);
      console.error('--------------------\n');
      process.exit(1); // Exit with a non-zero code to indicate failure
  }
})();