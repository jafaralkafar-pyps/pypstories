const fs = require('fs');
const path = require('path');

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads', 'comics');

class LocalStorage {
  constructor() {
    // Ensure base directory exists
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }

  /**
   * Upload a file buffer to local storage.
   * @param {Buffer} buffer - The file content
   * @param {string} key - e.g. 'comics/42/page-123-abc.jpg'
   * @returns {Promise<{key: string}>}
   */
  async upload(buffer, key) {
    if (!key || !key.startsWith('comics/')) {
      throw new Error('Invalid storage key. Must start with "comics/"');
    }

    const relativePath = key.replace(/^comics\//, '');
    const fullPath = path.join(UPLOADS_DIR, relativePath);

    // Ensure directory exists
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });

    // Write the file
    fs.writeFileSync(fullPath, buffer);

    return { key };
  }

  /**
   * Get the public URL for a stored key.
   * For local, returns a path that the static middleware serves.
   * @param {string} key
   * @returns {string}
   */
  getPublicUrl(key) {
    if (!key) return null;
    const relativePath = key.replace(/^comics\//, '');
    return `/uploads/comics/${relativePath}`;
  }

  /**
   * Delete a file by key.
   * @param {string} key
   */
  async delete(key) {
    if (!key) return;
    const relativePath = key.replace(/^comics\//, '');
    const fullPath = path.join(UPLOADS_DIR, relativePath);
    try {
      fs.unlinkSync(fullPath);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.error('Failed to delete local file:', err);
      }
    }
  }
}

function createStorage() {
  const type = (process.env.STORAGE_TYPE || 'local').toLowerCase();

  if (type === 'local') {
    return new LocalStorage();
  }

  // Placeholder for future cloud implementations
  if (type === 'r2' || type === 's3') {
    throw new Error('Cloud storage (R2/S3) not implemented yet. Use STORAGE_TYPE=local for now.');
  }

  throw new Error(`Unknown STORAGE_TYPE: ${type}. Supported: local`);
}

module.exports = createStorage();
