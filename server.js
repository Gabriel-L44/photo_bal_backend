// server.js - simple Express server to receive uploads and push to Google Drive via service account
// Usage:
// - set environment variable SERVICE_ACCOUNT_JSON with the JSON content of the service account key
// - set DRIVE_FOLDER_ID to the ID of the Drive folder shared with the service account (optional)
// - set ALLOWED_ORIGINS to a comma-separated list of allowed frontend origins (optional, default: *)
//
// Deploy on Railway/Render/Vercel/Replit and add these env vars there.

const express = require('express');
const multer = require('multer');
const {google} = require('googleapis');
const cors = require('cors');

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } }); // 8MB limit

const PORT = process.env.PORT || 3000;
const SERVICE_ACCOUNT_JSON = process.env.SERVICE_ACCOUNT_JSON || null;
const DRIVE_FOLDER_ID = process.env.DRIVE_FOLDER_ID || null;
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : ['*'];

if (!SERVICE_ACCOUNT_JSON) {
  console.error('SERVICE_ACCOUNT_JSON is missing. Set the service account JSON in env variable SERVICE_ACCOUNT_JSON.');
  process.exit(1);
}

let authClient;
try {
  const key = JSON.parse(SERVICE_ACCOUNT_JSON);
  authClient = new google.auth.JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: ['https://www.googleapis.com/auth/drive']
  });
} catch (err) {
  console.error('Failed to parse SERVICE_ACCOUNT_JSON', err);
  process.exit(1);
}

const drive = google.drive({ version: 'v3', auth: authClient });

// CORS: allow the frontends you will host on
app.use(cors({
  origin: function(origin, callback){
    if (!origin) return callback(null, true); // allow non-browser clients or same-origin
    if (ALLOWED_ORIGINS.indexOf('*') !== -1) return callback(null, true);
    if (ALLOWED_ORIGINS.indexOf(origin) !== -1) return callback(null, true);
    return callback(new Error('Origin not allowed by CORS'));
  }
}));

app.get('/', (req, res) => {
  res.json({ ok: true, now: new Date().toISOString() });
});

// POST /upload - expects multipart/form-data with field 'photo' (file) and optional 'phoneId'
app.post('/upload', upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file provided' });

    // Optional: basic rate-limit / one-photo-per-phone by phoneId or IP
    // Note: This is not bulletproof. For stronger guarantees use a database.
    const phoneId = req.body.phoneId || null;
    const remoteIp = req.headers['x-forwarded-for'] || req.connection.remoteAddress;

    // Prepare metadata
    const filename = `photo_bal_${new Date().toISOString().replace(/[:.]/g,'-')}.jpg`;
    const fileMetadata = {
      name: filename,
      mimeType: 'image/jpeg'
    };
    if (DRIVE_FOLDER_ID) fileMetadata.parents = [DRIVE_FOLDER_ID];

    // Upload the file
    const media = {
      mimeType: 'image/jpeg',
      body: Buffer.from(req.file.buffer)
    };

    const response = await drive.files.create({
      resource: fileMetadata,
      media: media,
      fields: 'id, name'
    });

    // Optionally, set permissions so only you (owner) can view. Typically the service account
    // who uploads owns the file in its Drive. If you shared a folder with the service account,
    // the file will be placed there.
    const fileId = response.data.id;

    res.json({ ok: true, fileId, name: response.data.name });
  } catch (err) {
    console.error('Upload error', err);
    res.status(500).json({ error: 'Upload failed', details: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
