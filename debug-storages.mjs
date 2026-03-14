import https from 'https';

// Read token from command line
const token = process.argv[2];
if (!token) {
  console.error('Usage: node debug-storages.mjs <token>');
  process.exit(1);
}

const postData = JSON.stringify({ method: 'getExternalStoragesList', parameters: '{}' });

const options = {
  hostname: 'api.baselinker.com',
  port: 443,
  path: '/connector.php',
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
    'X-BLToken': token,
    'Content-Length': Buffer.byteLength(`method=getExternalStoragesList&parameters={}`),
  },
};

const req = https.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    try {
      const parsed = JSON.parse(data);
      if (parsed.storages) {
        console.log(`\nTotal storages: ${parsed.storages.length}\n`);
        parsed.storages.forEach((s, i) => {
          console.log(`${i+1}. ID: ${s.storage_id} | Name: ${s.name} | Read: ${s.read} | Write: ${s.write}`);
        });
      } else {
        console.log('Response:', JSON.stringify(parsed, null, 2));
      }
    } catch (e) {
      console.log('Raw response:', data);
    }
  });
});

req.write(`method=getExternalStoragesList&parameters={}`);
req.end();
