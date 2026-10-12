const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

let supabase = null;

function getStorageClient() {
    if (supabase) return supabase;

    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY;
    if (!url || !key) {
        console.warn('[Storage] SUPABASE_URL and SUPABASE_SERVICE_KEY not set – file storage disabled.');
        return null;
    }
    supabase = createClient(url, key, {
        auth: { persistSession: false }
    });
    return supabase;
}

async function ensureBucket(bucket, opts = {}) {
    const sb = getStorageClient();
    if (!sb) return;
    const publicAccess = opts.public !== false;
    const { data, error } = await sb.storage.getBucket(bucket);
    if (error && error.message && /not found/i.test(error.message)) {
        await sb.storage.createBucket(bucket, { public: publicAccess });
    } else if (data && data.public !== publicAccess) {
        await sb.storage.updateBucket(bucket, { public: publicAccess });
    }
}

function localDir() {
    return process.env.LOCAL_STORAGE_DIR || path.join(__dirname, '..', '..', 'uploads');
}

function isSupabaseConfigured() {
    return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY);
}

async function uploadBuffer(bucket, fileName, buffer, contentType, opts = {}) {
    if (!isSupabaseConfigured()) {
        // Own-server fallback: store on local disk under ./uploads/<bucket>/<fileName>.
        const dir = path.join(localDir(), bucket);
        fs.mkdirSync(dir, { recursive: true });
        const safeName = String(fileName).replace(/[^a-zA-Z0-9._-]/g, '_');
        fs.writeFileSync(path.join(dir, safeName), buffer);
        return `/uploads/${bucket}/${safeName}`;
    }
    const sb = getStorageClient();
    await ensureBucket(bucket, opts);
    const { error } = await sb.storage.from(bucket).upload(fileName, buffer, {
        contentType,
        cacheControl: '3600',
        upsert: true
    });
    if (error) throw error;
    const { data } = sb.storage.from(bucket).getPublicUrl(fileName);
    return data.publicUrl;
}

async function deleteFile(bucket, fileName) {
    if (!fileName) return;
    const sb = getStorageClient();
    if (!sb) return;
    const { error } = await sb.storage.from(bucket).remove([fileName]);
    if (error && !/not found/i.test(error.message)) {
        console.error('Storage delete error:', error.message);
    }
}

// Delete a file given its public URL (extracts bucket + object path).
// Handles both Supabase URLs and local /uploads/<bucket>/<file> URLs.
async function deleteFileByUrl(publicUrl) {
    if (!publicUrl) return;
    const local = String(publicUrl).match(/^\/uploads\/([^/]+)\/(.+)$/);
    if (local) {
        try { fs.unlinkSync(path.join(localDir(), local[1], path.basename(local[2]))); } catch (e) { /* already gone */ }
        return;
    }
    const m = String(publicUrl).match(/\/object\/public\/([^/]+)\/(.+)$/);
    if (!m) return;
    await deleteFile(m[1], m[2]);
}

module.exports = { uploadBuffer, deleteFile, deleteFileByUrl, getStorageClient };
