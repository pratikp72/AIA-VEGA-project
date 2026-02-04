/**
 * Direct Upload Media Field Component
 * 
 * Allows users to upload media files directly from their PC during content entry
 * without needing to use the Media Library first.
 * This component adds a direct upload button alongside the default media field.
 */

import React, { useState, useCallback } from 'react';
import { useIntl } from 'react-intl';
import { Button, Box } from '@strapi/design-system';
import { Upload } from '@strapi/icons';
import { useFetchClient } from '@strapi/strapi/admin';

const DirectUploadMediaField = ({
  name,
  value,
  onChange,
  attribute,
  disabled,
}) => {
  const { formatMessage } = useIntl();
  const fetchClient = useFetchClient();
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);

  // Helper function to determine file type
  const getFileType = (file) => {
    const mimeType = file.type || '';
    if (mimeType.startsWith('image/')) return 'images';
    if (mimeType.startsWith('video/')) return 'videos';
    if (mimeType.startsWith('audio/')) return 'audios';
    return 'files';
  };

  // Helper function to check if file type is allowed
  const isFileTypeAllowed = (fileType, allowedTypes) => {
    return allowedTypes.includes(fileType);
  };

  // Get accepted file types for input
  const getAcceptedTypes = () => {
    const allowedTypes = attribute?.allowedTypes || ['images', 'files', 'videos', 'audios'];
    const mimeTypes = [];
    
    if (allowedTypes.includes('images')) {
      mimeTypes.push('image/*');
    }
    if (allowedTypes.includes('videos')) {
      mimeTypes.push('video/*');
    }
    if (allowedTypes.includes('audios')) {
      mimeTypes.push('audio/*');
    }
    if (allowedTypes.includes('files')) {
      mimeTypes.push('application/*', 'text/*');
    }
    
    return mimeTypes.join(',');
  };

  const handleFileSelect = useCallback(async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type based on allowedTypes
    const allowedTypes = attribute?.allowedTypes || ['images', 'files', 'videos', 'audios'];
    const fileType = getFileType(file);
    
    if (!isFileTypeAllowed(fileType, allowedTypes)) {
      setUploadError(
        formatMessage(
          { id: 'direct-upload.error.invalid-type', defaultMessage: 'File type not allowed' },
          { type: fileType }
        )
      );
      return;
    }

    setUploading(true);
    setUploadError(null);

    try {
      // Create FormData for file upload
      const formData = new FormData();
      formData.append('files', file);
      
      // Add alternative text if provided
      if (file.name) {
        formData.append('fileInfo', JSON.stringify({
          alternativeText: file.name,
          caption: file.name,
        }));
      }

      // Upload file directly to Strapi using custom route
      // This route bypasses Media Library permissions
      const { data } = await fetchClient.post('/modules-sidebar/upload', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      // Handle response - data can be array or single object
      const uploadedFile = Array.isArray(data) ? data[0] : data;
      
      if (uploadedFile && uploadedFile.id) {
        // Update the field value with the uploaded file ID
        if (attribute?.multiple) {
          const currentValue = Array.isArray(value) ? value : value ? [value] : [];
          onChange({
            target: {
              name,
              value: [...currentValue, uploadedFile.id],
            },
          });
        } else {
          onChange({
            target: {
              name,
              value: uploadedFile.id,
            },
          });
        }
        setUploadError(null);
      } else {
        throw new Error('Upload failed - no file ID returned');
      }
    } catch (error) {
      console.error('Direct upload error:', error);
      setUploadError(
        formatMessage(
          { 
            id: 'direct-upload.error.upload-failed', 
            defaultMessage: 'Upload failed: {message}' 
          },
          { message: error.message || 'Unknown error' }
        )
      );
    } finally {
      setUploading(false);
      // Reset file input
      event.target.value = '';
    }
  }, [attribute, fetchClient, name, onChange, value, formatMessage]);

  return (
    <Box paddingTop={2} paddingBottom={2}>
      <input
        type="file"
        id={`direct-upload-${name}`}
        accept={getAcceptedTypes()}
        onChange={handleFileSelect}
        disabled={disabled || uploading}
        style={{ display: 'none' }}
      />
      <label htmlFor={`direct-upload-${name}`}>
        <Button
          component="span"
          variant="secondary"
          startIcon={<Upload />}
          disabled={disabled || uploading}
          loading={uploading}
          size="S"
        >
          {uploading
            ? formatMessage({ id: 'direct-upload.uploading', defaultMessage: 'Uploading...' })
            : formatMessage({ id: 'direct-upload.upload', defaultMessage: 'Upload from PC' })}
        </Button>
      </label>
      {uploadError && (
        <Box paddingTop={2}>
          <div style={{ color: 'red', fontSize: '12px' }}>
            {uploadError}
          </div>
        </Box>
      )}
    </Box>
  );
};

export default DirectUploadMediaField;
