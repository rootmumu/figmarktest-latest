const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

/**
 * Compresses a file on disk using Gzip, deletes the original,
 * and returns metadata (originalSize, compressedSize, isCompressed).
 * @param {string} filePath - Absolute or relative path to the file
 * @returns {Promise<{originalSize: string, compressedSize: string, isCompressed: boolean, filename: string}>}
 */
const compressFile = (filePath) => {
  return new Promise((resolve, reject) => {
    try {
      if (!fs.existsSync(filePath)) {
        return reject(new Error('File does not exist'));
      }

      const stats = fs.statSync(filePath);
      const originalSizeBytes = stats.size;
      const originalSizeMB = (originalSizeBytes / 1024 / 1024).toFixed(2) + ' MB';

      const fileBuffer = fs.readFileSync(filePath);
      const compressedBuffer = zlib.gzipSync(fileBuffer);
      const compressedSizeBytes = compressedBuffer.length;
      const compressedSizeMB = (compressedSizeBytes / 1024 / 1024).toFixed(2) + ' MB';

      const compressedPath = filePath + '.gz';
      fs.writeFileSync(compressedPath, compressedBuffer);
      fs.unlinkSync(filePath); // delete original uncompressed file

      resolve({
        originalSize: originalSizeMB,
        compressedSize: compressedSizeMB,
        isCompressed: true,
        filename: path.basename(filePath)
      });
    } catch (error) {
      reject(error);
    }
  });
};

module.exports = { compressFile };
