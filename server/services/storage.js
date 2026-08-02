const { createClient } = require('@supabase/supabase-js');

let supabase = null;

function getStorageClient() {
    if (supabase) return supabase;

    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY;
    if (!url || !key) {
        throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY are required for file storage');
    }
    supabase = createClient(url, key, {
        auth: { persistSession: false }
    });
    return supabase;
}

async function ensureBucket(bucket) {
    const sb = getStorageClient();
    const { error } = await sb.storage.getBucket(bucket);
    if (error && error.message && /not found/i.test(error.message)) {
        await sb.storage.createBucket(bucket, { public: true });
    }
}

async function uploadBuffer(bucket, fileName, buffer, contentType) {
    const sb = getStorageClient();
    await ensureBucket(bucket);
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
    const { error } = await sb.storage.from(bucket).remove([fileName]);
    if (error && !/not found/i.test(error.message)) {
        console.error('Storage delete error:', error.message);
    }
}

// Delete a file given its public URL (extracts bucket + object path).
async function deleteFileByUrl(publicUrl) {
    if (!publicUrl) return;
    const m = String(publicUrl).match(/\/object\/public\/([^/]+)\/(.+)$/);
    if (!m) return;
    await deleteFile(m[1], m[2]);
}

module.exports = { uploadBuffer, deleteFile, deleteFileByUrl, getStorageClient };
